import * as net from "net";
import * as dgram from "dgram";
import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";

export enum ClassroomStatus {
	Disconnected = "disconnected",
	Hosting = "hosting",
	Connected = "connected"
}

export interface ConnectedStudent {
	uuid: string;
	name: string;
	avatar: string;
}

export interface ClassroomEvent {
	uuid: string;
	name: string;
	avatar: string;
	text: string;
	fileName?: string;
	fileBase64?: string;
	isMine: boolean;
	eventType: string;
	selectionStart?: number;
	selectionEnd?: number;
	timestamp?: number;
}

export class ClassroomService {
	private static instance: ClassroomService;

	public static getInstance(): ClassroomService {
			if (!ClassroomService.instance) {
					ClassroomService.instance = new ClassroomService();
			}
			return ClassroomService.instance;
	}

	private serverSocket?: net.Server;
	private clientSocket?: net.Socket;
	private hostClientSockets: Set<net.Socket> = new Set();
	private socketToUuid: Map<net.Socket, string> = new Map();

	public status: ClassroomStatus = ClassroomStatus.Disconnected;
	public roomCode?: string;
	public connectedStudents: ConnectedStudent[] = [];
	public isLiveCodeSharingEnabled: boolean = true;
	public isBroadcastingToHost: boolean = false;

	private _onMessage = new vscode.EventEmitter<ClassroomEvent>();
	public readonly onMessage = this._onMessage.event;

	private _onStatusChanged = new vscode.EventEmitter<ClassroomStatus>();
	public readonly onStatusChanged = this._onStatusChanged.event;

	public identityUuid: string = "";
	public identityName: string = "Unknown";
	public identityAvatar: string = "🐼";

	public get isHost(): boolean {
			return !!this.serverSocket;
	}

	private updateStatus(s: ClassroomStatus) {
			this.status = s;
			this._onStatusChanged.fire(s);
	}

	public async initIdentity(context: vscode.ExtensionContext) {
			let uuid = context.globalState.get<string>("identity_uuid");
			if (!uuid) {
					uuid = uuidv4();
					await context.globalState.update("identity_uuid", uuid);
			}
			this.identityUuid = uuid;
			this.identityName = context.globalState.get<string>("identity_name") || "Unknown";
			this.identityAvatar = context.globalState.get<string>("identity_avatar") || "🐼";
	}

	public async saveIdentity(context: vscode.ExtensionContext, name: string, avatar: string) {
			this.identityName = name;
			this.identityAvatar = avatar;
			await context.globalState.update("identity_name", name);
			await context.globalState.update("identity_avatar", avatar);
	}

	private getLocalIp(): string | null {
			const os = require("os");
			const interfaces = os.networkInterfaces();
			for (const name of Object.keys(interfaces)) {
					for (const iface of interfaces[name]) {
							if (iface.family === "IPv4" && !iface.internal) {
									return iface.address;
							}
					}
			}
			return null;
	}

	private encodeRoomCode(ip: string, port: number): string {
			const parts = ip.split(".");
			const buf = Buffer.alloc(6);
			buf.writeUInt8(parseInt(parts[0]), 0);
			buf.writeUInt8(parseInt(parts[1]), 1);
			buf.writeUInt8(parseInt(parts[2]), 2);
			buf.writeUInt8(parseInt(parts[3]), 3);
			buf.writeUInt16BE(port, 4);

			const hexString = buf.toString("hex");
			const bigInt = BigInt("0x" + hexString);
			const base36 = bigInt.toString(36).toUpperCase();

			if (base36.length > 5) {
					const mid = Math.floor(base36.length / 2);
					return `${base36.substring(0, mid)}-${base36.substring(mid)}`;
			}
			return base36;
	}

	private decodeRoomCode(code: string): [string, number] | null {
			try {
					const cleanCode = code.replace(/-/g, "").replace(/ /g, "").trim().toLowerCase();
					const bigInt = this.parseBigInt(cleanCode, 36);
					let hexString = bigInt.toString(16);
					while (hexString.length < 12) hexString = "0" + hexString;
					
					if (hexString.length !== 12) return null;

					const ip1 = parseInt(hexString.substring(0, 2), 16);
					const ip2 = parseInt(hexString.substring(2, 4), 16);
					const ip3 = parseInt(hexString.substring(4, 6), 16);
					const ip4 = parseInt(hexString.substring(6, 8), 16);
					const port = parseInt(hexString.substring(8, 12), 16);

					return [`${ip1}.${ip2}.${ip3}.${ip4}`, port];
			} catch (e) {
					return null;
			}
	}

	private parseBigInt(str: string, base: number): bigint {
			const charSet = "0123456789abcdefghijklmnopqrstuvwxyz";
			let res = BigInt(0);
			for (let i = 0; i < str.length; i++) {
					res = res * BigInt(base) + BigInt(charSet.indexOf(str[i]));
			}
			return res;
	}

	public async hostRoom(customCode?: string): Promise<void> {
			return new Promise((resolve, reject) => {
					try {
							const ip = this.getLocalIp();
							if (!ip) throw new Error("Tidak ada koneksi WiFi/LAN.");

							this.serverSocket = net.createServer((socket) => {
									this.hostClientSockets.add(socket);
									this.listenToSocket(socket, true);
									if (this.status !== ClassroomStatus.Connected) {
											this.updateStatus(ClassroomStatus.Connected);
									}
							});

							this.serverSocket.listen(0, ip, () => {
									const address = this.serverSocket!.address() as net.AddressInfo;
									
									if (customCode && customCode.trim().length > 0) {
											this.roomCode = customCode.trim();
											try {
													const udpServer = dgram.createSocket("udp4");
													udpServer.on("message", (msg, rinfo) => {
															const text = msg.toString("utf8");
															if (text === `FIND:${this.roomCode}`) {
																	const reply = Buffer.from(`FOUND:${address.port}`, "utf8");
																	udpServer.send(reply, rinfo.port, rinfo.address);
															}
													});
													udpServer.bind(45222);
											} catch (e) {
													// ignore UDP bind err
											}
									} else {
											this.roomCode = this.encodeRoomCode(ip, address.port);
									}

									this.hostClientSockets.clear();
									this.socketToUuid.clear();
									this.connectedStudents = [];
									this.updateStatus(ClassroomStatus.Hosting);
									resolve();
							});
							this.serverSocket.on("error", (e) => {
									this.disconnect();
									reject(e);
							});
					} catch (e) {
							this.disconnect();
							reject(e);
					}
			});
	}

	public async joinRoom(code: string): Promise<void> {
			return new Promise(async (resolve, reject) => {
					try {
							let ip: string;
							let port: number;

							const decoded = this.decodeRoomCode(code);
							if (decoded) {
									ip = decoded[0];
									port = decoded[1];
									this.connectTcp(ip, port, code, resolve, reject);
							} else {
									// UDP Discovery
									const udpSocket = dgram.createSocket("udp4");
									udpSocket.bind(() => {
											udpSocket.setBroadcast(true);
									});

									let resolved = false;

									udpSocket.on("message", (msg) => {
											const text = msg.toString("utf8");
											if (text.startsWith("FOUND:")) {
													if (!resolved) {
															resolved = true;
															const tcpPort = parseInt(text.substring(6));
															// get IP from rinfo, wait we don"t have rinfo here, let"s fix
													}
											}
									});

									// We need rinfo
									udpSocket.removeAllListeners("message");
									udpSocket.on("message", (msg, rinfo) => {
											const text = msg.toString("utf8");
											if (text.startsWith("FOUND:")) {
													if (!resolved) {
															resolved = true;
															const tcpPort = parseInt(text.substring(6));
															udpSocket.close();
															this.connectTcp(rinfo.address, tcpPort, code, resolve, reject);
													}
											}
									});

									const payload = Buffer.from(`FIND:${code.trim()}`, "utf8");
									let attempts = 0;
									const interval = setInterval(() => {
											if (resolved) {
													clearInterval(interval);
													return;
											}
											if (attempts >= 5) {
													clearInterval(interval);
													udpSocket.close();
													reject(new Error(`Room "${code}" tidak ditemukan di jaringan lokal.`));
													return;
											}
											udpSocket.send(payload, 45222, "255.255.255.255");
											attempts++;
									}, 500);
							}
					} catch (e) {
							this.disconnect();
							reject(e);
					}
			});
	}

	private connectTcp(ip: string, port: number, code: string, resolve: any, reject: any) {
			this.clientSocket = net.createConnection({ host: ip, port: port }, () => {
					this.roomCode = code.trim();
					this.connectedStudents = [];
					this.listenToSocket(this.clientSocket!, false);
					this.updateStatus(ClassroomStatus.Connected);

					const joinMsg: ClassroomEvent = {
							uuid: this.identityUuid,
							name: this.identityName,
							avatar: this.identityAvatar,
							text: "",
							isMine: true,
							eventType: "join"
					};
					this.clientSocket!.write(JSON.stringify(joinMsg) + "\n");
					resolve();
			});

			this.clientSocket.on("error", (e) => {
					this.disconnect();
					reject(e);
			});
	}

	private listenToSocket(socket: net.Socket, isHostSide: boolean) {
			let buffer = "";
			socket.on("data", (data) => {
					buffer += data.toString("utf8");
					let newlineIdx;
					while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
							const line = buffer.substring(0, newlineIdx).trim();
							buffer = buffer.substring(newlineIdx + 1);
							
							if (line.length === 0) continue;

							try {
									const jsonMap = JSON.parse(line);
									
									if (jsonMap.eventType === "join") {
											if (isHostSide) {
													const student: ConnectedStudent = {
															uuid: jsonMap.uuid,
															name: jsonMap.name || "Unknown",
															avatar: jsonMap.avatar || "🐼"
													};
													this.connectedStudents.push(student);
													this.socketToUuid.set(socket, student.uuid);
													this.broadcastStudentsList();
													this.updateStatus(this.status);
											}
											continue;
									}

									if (jsonMap.eventType === "students_list") {
											if (!isHostSide) {
													this.connectedStudents = jsonMap.students;
													this.updateStatus(this.status);
											}
											continue;
									}

									const msg = jsonMap as ClassroomEvent;
									msg.isMine = false;

									if (msg.eventType === "chat" && isHostSide) {
											this.broadcast(line + "\n", socket);
									}
									this._onMessage.fire(msg);

							} catch (e) {
									// Ignore parse errors
							}
					}
			});

			socket.on("close", () => this.handleSocketClosed(socket, isHostSide));
			socket.on("error", () => this.handleSocketClosed(socket, isHostSide));
	}

	private handleSocketClosed(socket: net.Socket, isHostSide: boolean) {
			if (isHostSide) {
					this.hostClientSockets.delete(socket);
					const uuid = this.socketToUuid.get(socket);
					if (uuid) {
							this.connectedStudents = this.connectedStudents.filter(s => s.uuid !== uuid);
							this.socketToUuid.delete(socket);
							this.broadcastStudentsList();
							this.updateStatus(this.status);
					}
					socket.destroy();
			} else {
					this.disconnect();
			}
	}

	private broadcastStudentsList() {
			const data = {
					eventType: "students_list",
					students: this.connectedStudents
			};
			this.broadcast(JSON.stringify(data) + "\n");
	}

	private broadcast(data: string, exclude?: net.Socket) {
			for (const s of this.hostClientSockets) {
					if (s !== exclude) {
							try {
									s.write(data);
							} catch (e) {}
					}
			}
	}

	public sendMessage(text: string, fileName?: string, fileBase64?: string) {
			if (this.status !== ClassroomStatus.Connected) return;
			if (!this.isHost && !this.clientSocket) return;

			const msg: ClassroomEvent = {
					uuid: this.identityUuid,
					name: this.identityName,
					avatar: this.identityAvatar,
					text: text,
					fileName: fileName,
					fileBase64: fileBase64,
					isMine: true,
					eventType: "chat",
					timestamp: Date.now()
			};

			const jsonString = JSON.stringify(msg) + "\n";

			if (this.isHost) {
					this.broadcast(jsonString);
			} else {
					this.clientSocket!.write(jsonString);
			}

			this._onMessage.fire(msg);
	}

	public broadcastLiveCode(codeContent: string, selectionStart?: number, selectionEnd?: number) {
			if (this.status !== ClassroomStatus.Connected || !this.isHost || !this.isLiveCodeSharingEnabled) return;

			const msg: ClassroomEvent = {
					uuid: this.identityUuid,
					name: this.identityName,
					avatar: this.identityAvatar,
					text: codeContent,
					isMine: true,
					eventType: "live_code",
					selectionStart: selectionStart,
					selectionEnd: selectionEnd
			};

			this.broadcast(JSON.stringify(msg) + "\n");
	}

	public sendStudentLiveCode(codeContent: string, selectionStart?: number, selectionEnd?: number) {
			if (this.status !== ClassroomStatus.Connected || this.isHost || !this.isBroadcastingToHost) return;

			const msg: ClassroomEvent = {
					uuid: this.identityUuid,
					name: this.identityName,
					avatar: this.identityAvatar,
					text: codeContent,
					isMine: true,
					eventType: "student_live_code",
					selectionStart: selectionStart,
					selectionEnd: selectionEnd
			};

			if (this.clientSocket) {
					this.clientSocket.write(JSON.stringify(msg) + "\n");
			}
	}

	public requestStudentCode(uuid: string) {
		if (!this.isHost) return;

		for (const [socket, u] of this.socketToUuid.entries()) {
			if (u === uuid) {
				const msg: ClassroomEvent = {
					uuid: uuid,
					name: this.identityName,
					avatar: this.identityAvatar,
					text: "true",
					isMine: false,
					eventType: "request_code_stream"
				};
				socket.write(JSON.stringify(msg) + "\\n");
				break;
			}
		}
	}

	public setLiveCodeSharing(enabled: boolean) {
			this.isLiveCodeSharingEnabled = enabled;
			if (!enabled && this.status === ClassroomStatus.Connected && this.isHost) {
					const msg: ClassroomEvent = {
							uuid: this.identityUuid,
							name: this.identityName,
							avatar: this.identityAvatar,
							text: "",
							isMine: true,
							eventType: "hide_live_code"
					};
					this.broadcast(JSON.stringify(msg) + "\n");
			}
	}

	public disconnect() {
			if (this.clientSocket) {
					this.clientSocket.destroy();
					this.clientSocket = undefined;
			}

			for (const s of this.hostClientSockets) {
					s.destroy();
			}
			this.hostClientSockets.clear();
			this.socketToUuid.clear();

			if (this.serverSocket) {
					this.serverSocket.close();
					this.serverSocket = undefined;
			}

			this.roomCode = undefined;
			this.connectedStudents = [];
			this.updateStatus(ClassroomStatus.Disconnected);
	}
}
