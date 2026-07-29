import * as vscode from 'vscode';
import { ClassroomService, ClassroomStatus, ClassroomEvent } from './classroomService';

export class RakodaRoomViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'rakodaRoomSidebar';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _classroomService: ClassroomService,
        private readonly _context: vscode.ExtensionContext
    ) {
        // Listen to service events to update webview
        this._classroomService.onStatusChanged((status) => {
            this._view?.webview.postMessage({ type: 'statusChanged', status, roomCode: this._classroomService.roomCode, isHost: this._classroomService.isHost });
        });

        this._classroomService.onMessage((msg) => {
            this._view?.webview.postMessage({ type: 'newMessage', message: msg });
        });

        // Also we need an event for student list update. Let's send statusChanged or specific event
        this._classroomService.onStatusChanged(() => {
            this._view?.webview.postMessage({ type: 'studentsList', students: this._classroomService.connectedStudents });
        });
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'saveIdentity': {
                    await this._classroomService.saveIdentity(this._context, data.name, data.avatar);
                    break;
                }
                case 'hostRoom': {
                    try {
                        await this._classroomService.hostRoom(data.customCode);
                    } catch (e: any) {
                        vscode.window.showErrorMessage(e.message);
                    }
                    break;
                }
                case 'joinRoom': {
                    try {
                        await this._classroomService.joinRoom(data.code);
                    } catch (e: any) {
                        vscode.window.showErrorMessage(e.message);
                    }
                    break;
                }
                case 'disconnect': {
                    this._classroomService.disconnect();
                    break;
                }
                case 'sendMessage': {
                    this._classroomService.sendMessage(data.text, data.fileName, data.fileBase64);
                    break;
                }
                case 'setLiveCode': {
                    this._classroomService.setLiveCodeSharing(data.enabled);
                    break;
                }
                case 'viewHostCode': {
                    const uriHost = vscode.Uri.parse('rakoda-live://teacher/LiveCode_Guru.txt');
                    vscode.commands.executeCommand('vscode.open', uriHost);
                    break;
                }
                case 'viewStudentCode': {
                    this._classroomService.requestStudentCode(data.uuid);
                    const safeName = (data.name || 'Unknown').replace(/\\s+/g, '_');
                    const uriStudent = vscode.Uri.parse(`rakoda-live://student/LiveCode_${safeName}.txt`);
                    vscode.commands.executeCommand('vscode.open', uriStudent);
                    break;
                }
                case 'downloadFile': {
                    const uri = await vscode.window.showSaveDialog({
                        defaultUri: vscode.Uri.file(data.fileName),
                        title: "Simpan Lampiran"
                    });
                    if (uri) {
                        try {
                            const buffer = Buffer.from(data.fileBase64, 'base64');
                            await vscode.workspace.fs.writeFile(uri, new Uint8Array(buffer));
                            vscode.window.showInformationMessage(`Berhasil menyimpan ${data.fileName}`);
                        } catch (e: any) {
                            vscode.window.showErrorMessage(`Gagal menyimpan file: ${e.message}`);
                        }
                    }
                    break;
                }
            }
        });

        // Initial state
        setTimeout(() => {
            webviewView.webview.postMessage({
                type: 'identityLoaded',
                name: this._classroomService.identityName,
                avatar: this._classroomService.identityAvatar
            });
            webviewView.webview.postMessage({ 
                type: 'statusChanged', 
                status: this._classroomService.status, 
                roomCode: this._classroomService.roomCode,
                isHost: this._classroomService.isHost
            });
            webviewView.webview.postMessage({ 
                type: 'studentsList', 
                students: this._classroomService.connectedStudents 
            });
        }, 500);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src https://api.dicebear.com data:;">
    <title>Rakoda Room</title>
    <style>
        :root {
            --primary: #3b82f6;
            --primary-hover: #2563eb;
            --bg: #222222;
            --panel: #2d2d2d;
            --border: #3a3a3a;
            --text: #e5e5e5;
            --text-muted: #9ca3af;
            --success: #10b981;
            --host-bg: #854d0e;
            --host-fg: #facc15;
        }
        body { 
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif); 
            padding: 0; 
            margin: 0;
            color: var(--text); 
            background-color: var(--bg);
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }
        * { box-sizing: border-box; }
        
        /* Typography */
        h1, h2, h3, h4, h5, p { margin: 0; }
        .text-center { text-align: center; }
        .mb-2 { margin-bottom: 8px; }
        .mb-4 { margin-bottom: 16px; }
        .mb-6 { margin-bottom: 24px; }
        .text-muted { color: var(--text-muted); }
        .text-sm { font-size: 13px; }
        
        /* Identity Section */
        #identitySection {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            padding: 20px;
        }
        
        /* Connect Section */
        #connectSection {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            padding: 20px;
            position: relative;
        }
        .settings-btn {
            position: absolute;
            top: 16px;
            right: 16px;
            background: transparent;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 6px;
            border-radius: 4px;
            transition: all 0.2s;
        }
        .settings-btn:hover { color: white; background: #2a2a2a; }
        .wifi-icon {
            width: 56px;
            height: 56px;
            color: #555555;
            margin-bottom: 20px;
        }
        .input-code {
            width: 100%;
            padding: 10px 12px;
            background: #1a1a1a;
            border: 1px solid var(--border);
            border-radius: 8px;
            color: white;
            font-size: 13px;
            outline: none;
            margin-bottom: 12px;
            transition: border-color 0.2s;
        }
        .input-code:focus { border-color: var(--primary); }
        .btn {
            width: 100%;
            padding: 10px 12px;
            border-radius: 8px;
            border: none;
            font-weight: 600;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .btn-primary { background: var(--primary); color: white; }
        .btn-primary:hover { background: var(--primary-hover); }
        .btn-text { background: transparent; color: var(--text-muted); font-weight: normal; }
        .btn-text:hover { color: white; }
        .divider {
            width: 100%;
            height: 1px;
            background: var(--border);
            margin: 24px 0;
        }
        
        /* Room Section */
        #roomSection {
            display: flex;
            flex-direction: column;
            height: 100%;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px;
            border-bottom: 1px solid var(--border);
            background: #1f1f1f;
        }
        .header-title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 15px; color: white; }
        .icon-btn {
            background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; border-radius: 4px;
        }
        .icon-btn:hover { color: white; background: #2a2a2a; }
        
        .room-info {
            padding: 12px;
            border-bottom: 1px solid var(--border);
            display: flex;
            flex-direction: column;
            gap: 12px;
            background: #252525;
        }
        .room-code {
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            background: #1F1F1F;
            border-bottom: 1px solid var(--border);
        }

        .room-code-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .host-badge {
            background: var(--host-bg); color: var(--host-fg); font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px;
        }
        .code-display {
            display: flex; align-items: center; gap: 4px; color: var(--success); font-weight: 700; font-size: 14px; letter-spacing: 1px;
        }
        .parenthesis::before {
            content: "(";
        }
        .parenthesis::after {
            content: ")";
        }
        
        /* Toggle Switch */
        .live-code-row { display: flex; justify-content: space-between; align-items: center; }
        .switch { position: relative; display: inline-block; width: 36px; height: 20px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #444; transition: .3s; border-radius: 20px; }
        .slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 3px; bottom: 3px; background-color: white; transition: .3s; border-radius: 50%; }
        input:checked + .slider { background-color: var(--primary); }
        input:checked + .slider:before { transform: translateX(16px); }
        
        /* Tabs */
        .tabs { display: flex; border-bottom: 1px solid var(--border); background: #222; }
        .tab {
            flex: 1; padding: 10px 0; text-align: center; cursor: pointer; color: var(--text-muted); border-bottom: 2px solid transparent; font-size: 13px;
            display: flex; align-items: center; justify-content: center; gap: 6px; transition: color 0.2s;
        }
        .tab:hover { color: white; }
        .tab.active { color: var(--primary); border-bottom-color: var(--primary); font-weight: 600; }
        
        /* Content Area */
        .content-area { flex: 1; overflow-y: auto; padding: 12px; position: relative; background: #1e1e1e; }
        .tab-content { display: none; height: 100%; }
        .tab-content.active { display: flex; flex-direction: column; }
        
        /* Chat Empty State */
        .empty-state {
            margin: auto; display: flex; flex-direction: column; align-items: center; color: var(--text-muted); text-align: center; justify-content: center; height: 100%;
        }
        .empty-icon { width: 44px; height: 44px; margin-bottom: 12px; color: #333; }
        
        /* Chat Messages */
        .chat-container { display: flex; flex-direction: column; gap: 12px; padding-bottom: 8px; }
        .chat-msg { display: flex; gap: 10px; }
        .chat-msg.mine { flex-direction: row-reverse; }
        .chat-avatar { width: 28px; height: 28px; border-radius: 50%; background: #333; overflow: hidden; flex-shrink: 0; }
        .chat-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .chat-bubble {
            background: var(--panel); padding: 8px 12px; border-radius: 10px; max-width: 85%;
        }
        .chat-msg.mine .chat-bubble {
            background: #2e384f;
            border: 1px solid #4160a1;
        } 
        .chat-name { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
        .chat-msg.mine .chat-name { text-align: right; }
        .chat-text { font-size: 13px; color: #fff; line-height: 1.4; word-wrap: break-word; }
        
        /* Participants List */
        .participant-list { display: flex; flex-direction: column; gap: 12px; }
        .participant-item { display: flex; align-items: center; gap: 12px; padding: 6px; border-radius: 6px; transition: background 0.2s; }
        .participant-item:hover { background: #2a2a2a; }
        .participant-name { font-size: 13px; color: white; font-weight: 500; }
        
        /* Chat Input Area */
        .chat-input-area {
            padding: 10px 12px; border-top: 1px solid var(--border); display: flex; align-items: center; gap: 8px; background: #222;
        }
        .chat-input-wrapper {
            flex: 1; display: flex; align-items: center; background: #2a2a2a; border-radius: 20px; padding: 2px 12px; border: 1px solid transparent; transition: border 0.2s;
        }
        .chat-input-wrapper:focus-within { border-color: var(--primary); }
        .chat-input {
            flex: 1; background: transparent; border: none; color: white; padding: 8px 0; outline: none; font-size: 13px;
        }
        .send-btn {
            width: 32px; height: 32px; border-radius: 50%; background: var(--success); border: none; cursor: pointer;
            display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; transition: transform 0.1s;
        }
        .send-btn:hover { transform: scale(1.05); }
        .send-btn:active { transform: scale(0.95); }
    </style>
</head>
<body>

    <!-- IDENTITY SECTION -->
    <div id="identitySection" style="display:none;">
        <svg class="wifi-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
        </svg>
        <h2 class="mb-2 text-center" style="color:white; font-size: 16px;">Profil Kamu</h2>
        <p class="text-center text-muted mb-6 text-sm">Masukkan nama untuk mulai berkolaborasi.</p>
        
        <input id="identityNameInput" class="input-code" type="text" placeholder="Nama Lengkap..." />
        <button id="saveIdentityBtn" class="btn btn-primary">Simpan Nama</button>
    </div>

    <!-- CONNECT SECTION -->
    <div id="connectSection" style="display:none;">
        <button id="openSettingsBtn" class="settings-btn" title="Ubah Nama">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
        </button>
        <svg class="wifi-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
            <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
            <line x1="12" y1="20" x2="12.01" y2="20"></line>
        </svg>
        <h2 class="mb-2 text-center" style="color:white; font-size: 16px;">Kolaborasi Jaringan Lokal</h2>
        <p class="text-center text-muted mb-6 text-sm">Chat dengan rekan satu WiFi tanpa internet.</p>
        
        <input id="roomCodeInput" class="input-code" type="text" placeholder="Masukkan Kode Room..." />
        <button id="joinBtn" class="btn btn-primary">Gabung ke Room</button>
        
        <div class="divider"></div>
        <button id="hostBtn" class="btn btn-text">Saya seorang Guru, buat room</button>
    </div>

    <!-- ROOM SECTION -->
    <div id="roomSection" style="display:none;">
        <div class="header">
            <div class="header-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                Room
            </div>
            <button id="disconnectBtn" class="icon-btn" title="Keluar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            </button>
        </div>
        
        <div class="room-code">
            <div class="room-code-row">
                <div class="host-badge" id="roleBadge">HOST</div>
                <div class="code-display">
                    <span style="color:#555">#</span>
                    <span id="roomCodeDisplay">----</span>
                </div>
                <button class="icon-btn" id="copyBtn" title="Salin Kode">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>
            </div>
        </div>

        <div class="room-info">
            <div class="live-code-row">
                <div style="display:flex; align-items:center; gap:8px;">
                    <svg style="color:var(--text-muted)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
                    <span style="color:var(--text-muted); font-size: 13px;">Live Code</span>
                </div>
                <label class="switch" id="hostLiveCodeToggleLabel">
                    <input type="checkbox" id="liveCodeToggle" checked>
                    <span class="slider"></span>
                </label>
                <button id="viewHostCodeBtn" class="btn btn-primary" style="display:none; padding: 4px 10px; font-size: 11px; width: auto; font-weight: 500;">Lihat Code</button>
            </div>
        </div>
        
        <div class="tabs">
            <div class="tab" id="tabSiswa" onclick="switchTab('siswa')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                Siswa <span id="siswaCount" class="parenthesis">0</span>
            </div>
            <div class="tab active" id="tabChat" onclick="switchTab('chat')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                Chat <span id="chatCount" class="parenthesis">0</span>
            </div>
        </div>
        
        <div class="content-area">
            <!-- Siswa Tab Content -->
            <div id="contentSiswa" class="tab-content">
                <div class="participant-list" id="participantsList">
                    <!-- Participants will be injected here -->
                </div>
            </div>
            
            <!-- Chat Tab Content -->
            <div id="contentChat" class="tab-content active">
                <div id="chatEmptyState" class="empty-state">
                    <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                    Belum ada pesan.<br>Kirim pesan pertama!
                </div>
                <div class="chat-container" id="chatBox">
                    <!-- Chat messages will be injected here -->
                </div>
            </div>
        </div>
        
        <!-- Chat Input Form -->
        <div class="chat-input-area" id="chatInputArea">
            <svg id="attachBtn" style="color:var(--text-muted); cursor:pointer;" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
            <input type="file" id="fileInput" style="display:none;" />
            <div class="chat-input-wrapper">
                <input id="chatInput" class="chat-input" type="text" placeholder="Ketik pesan..." />
            </div>
            <button id="sendBtn" class="send-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        let currentUserName = "Guest-" + Math.floor(Math.random() * 10000);
        let currentUserAvatar = \`https://api.dicebear.com/9.x/adventurer/png?seed=\${encodeURIComponent(currentUserName)}\`;
        
        let chatMessagesCount = 0;
        let isHost = false;

        // Elements
        const roomCodeInput = document.getElementById('roomCodeInput');
        const identityNameInput = document.getElementById('identityNameInput');
        
        document.getElementById('saveIdentityBtn').addEventListener('click', () => {
            const name = identityNameInput.value.trim();
            if(name) {
                currentUserName = name;
                currentUserAvatar = \`https://api.dicebear.com/9.x/adventurer/png?seed=\${encodeURIComponent(currentUserName)}\`;
                vscode.postMessage({ type: 'saveIdentity', name: currentUserName, avatar: currentUserAvatar });
                
                document.getElementById('identitySection').style.display = 'none';
                document.getElementById('connectSection').style.display = 'flex';
            }
        });

        document.getElementById('openSettingsBtn').addEventListener('click', () => {
            identityNameInput.value = currentUserName !== 'Unknown' ? currentUserName : '';
            document.getElementById('connectSection').style.display = 'none';
            document.getElementById('roomSection').style.display = 'none';
            document.getElementById('identitySection').style.display = 'flex';
        });
        
        document.getElementById('hostBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'hostRoom', customCode: roomCodeInput.value });
        });

        document.getElementById('joinBtn').addEventListener('click', () => {
            if(!roomCodeInput.value) return;
            vscode.postMessage({ type: 'joinRoom', code: roomCodeInput.value });
        });

        document.getElementById('disconnectBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'disconnect' });
        });

        const chatInput = document.getElementById('chatInput');
        const sendMsg = () => {
            if (chatInput.value.trim().length > 0) {
                vscode.postMessage({ type: 'sendMessage', text: chatInput.value });
                chatInput.value = '';
            }
        };
        document.getElementById('sendBtn').addEventListener('click', sendMsg);
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMsg();
        });

        const fileInput = document.getElementById('fileInput');
        document.getElementById('attachBtn').addEventListener('click', () => {
            fileInput.click();
        });
        
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            if (file.size > 20 * 1024 * 1024) {
                alert('Ukuran file maksimal 20 MB');
                return;
            }
            
            const reader = new FileReader();
            reader.onload = (ev) => {
                const base64Data = ev.target.result.split(',')[1];
                vscode.postMessage({ type: 'sendMessage', text: '📎 Lampiran File', fileName: file.name, fileBase64: base64Data });
            };
            reader.readAsDataURL(file);
            fileInput.value = ''; 
        });
        
        document.getElementById('liveCodeToggle').addEventListener('change', (e) => {
            vscode.postMessage({ type: 'setLiveCode', enabled: e.target.checked });
        });
        document.getElementById('viewHostCodeBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'viewHostCode' });
        });

        document.getElementById('copyBtn').addEventListener('click', () => {
            const code = document.getElementById('roomCodeDisplay').innerText;
            navigator.clipboard.writeText(code);
            
            // Visual feedback
            const btn = document.getElementById('copyBtn');
            const originalHtml = btn.innerHTML;
            btn.innerHTML = \`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>\`;
            setTimeout(() => { btn.innerHTML = originalHtml; }, 2000);
        });

        // Tab Switching
        window.switchTab = function(tabName) {
            document.getElementById('tabSiswa').classList.remove('active');
            document.getElementById('tabChat').classList.remove('active');
            document.getElementById('contentSiswa').classList.remove('active');
            document.getElementById('contentChat').classList.remove('active');
            
            if (tabName === 'siswa') {
                document.getElementById('tabSiswa').classList.add('active');
                document.getElementById('contentSiswa').classList.add('active');
                document.getElementById('chatInputArea').style.display = 'none';
            } else {
                document.getElementById('tabChat').classList.add('active');
                document.getElementById('contentChat').classList.add('active');
                document.getElementById('chatInputArea').style.display = 'flex';
                // scroll to bottom
                const contentArea = document.querySelector('.content-area');
                contentArea.scrollTop = contentArea.scrollHeight;
            }
        };

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'identityLoaded':
                    let hasIdentity = false;
                    if (message.name && message.name !== "Unknown") {
                        currentUserName = message.name;
                        hasIdentity = true;
                    }
                    if (message.avatar && message.avatar.startsWith('http')) {
                        currentUserAvatar = message.avatar;
                    } else {
                        // Generate dicebear avatar and update backend
                        currentUserAvatar = \`https://api.dicebear.com/9.x/adventurer/png?seed=\${encodeURIComponent(currentUserName)}\`;
                        vscode.postMessage({ type: 'saveIdentity', name: currentUserName, avatar: currentUserAvatar });
                    }
                    
                    if (hasIdentity) {
                        document.getElementById('identitySection').style.display = 'none';
                        document.getElementById('connectSection').style.display = 'flex';
                    } else {
                        document.getElementById('identitySection').style.display = 'flex';
                        document.getElementById('connectSection').style.display = 'none';
                    }
                    break;
                    
                case 'statusChanged':
                    const s = message.status;
                    if (s === 'disconnected') {
                        document.getElementById('connectSection').style.display = 'flex';
                        document.getElementById('roomSection').style.display = 'none';
                        document.getElementById('chatBox').innerHTML = '';
                        document.getElementById('chatEmptyState').style.display = 'flex';
                        chatMessagesCount = 0;
                        document.getElementById('chatCount').innerText = '0';
                    } else {
                        document.getElementById('connectSection').style.display = 'none';
                        document.getElementById('roomSection').style.display = 'flex';
                        document.getElementById('roomCodeDisplay').innerText = message.roomCode || '';
                        
                        isHost = message.isHost;
                        const roleBadge = document.getElementById('roleBadge');
                        const hostLabel = document.getElementById('hostLiveCodeToggleLabel');
                        const viewHostBtn = document.getElementById('viewHostCodeBtn');
                        
                        if (isHost) {
                            roleBadge.innerText = 'HOST';
                            roleBadge.style.background = 'var(--host-bg)';
                            roleBadge.style.color = 'var(--host-fg)';
                            if (hostLabel) hostLabel.style.display = 'inline-block';
                            if (viewHostBtn) viewHostBtn.style.display = 'none';
                        } else {
                            roleBadge.innerText = 'GUEST';
                            roleBadge.style.background = '#1e3a8a';
                            roleBadge.style.color = '#93c5fd';
                            if (hostLabel) hostLabel.style.display = 'none';
                            if (viewHostBtn) viewHostBtn.style.display = 'inline-block';
                        }
                    }
                    break;
                    
                case 'newMessage':
                    const chatBox = document.getElementById('chatBox');
                    const emptyState = document.getElementById('chatEmptyState');
                    const msg = message.message;
                    
                    if (msg.eventType !== 'chat') break;
                    
                    emptyState.style.display = 'none';
                    chatMessagesCount++;
                    document.getElementById('chatCount').innerText = chatMessagesCount.toString();
                    
                    const div = document.createElement('div');
                    div.className = 'chat-msg ' + (msg.isMine ? 'mine' : '');
                    
                    let avatarSrc = msg.avatar;
                    if (!avatarSrc || !avatarSrc.startsWith('http')) {
                        avatarSrc = \`https://api.dicebear.com/9.x/adventurer/png?seed=\${encodeURIComponent(msg.name)}\`;
                    }
                    
                    let attachmentHtml = '';
                    if (msg.fileName) {
                        attachmentHtml = \`
                            <div style="background: rgba(0,0,0,0.2); padding: 6px; border-radius: 6px; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #ccc;"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
                                <span style="font-size: 11px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">\${msg.fileName}</span>
                                <button onclick="vscode.postMessage({ type: 'downloadFile', fileName: '\${msg.fileName}', fileBase64: '\${msg.fileBase64}' })" style="background: transparent; border: none; cursor: pointer; color: var(--primary); padding: 2px;">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                                </button>
                            </div>
                        \`;
                    }
                    
                    div.innerHTML = msg.isMine ? \`
                        <div style="display:flex; flex-direction:column; flex: 1; max-width:80%; align-items: flex-end;">
                            <div class="chat-bubble" style="max-width: 100%;">
                                \${attachmentHtml}
                                <div class="chat-text">\${msg.text}</div>
                            </div>
                        </div>
                    \` : \`
                        <div class="chat-avatar">
                            <img src="\${avatarSrc}" alt="\${msg.name}" />
                        </div>
                        <div style="display:flex; flex-direction:column; flex: 1; max-width:80%; align-items: flex-start;">
                            <div class="chat-name">\${msg.name}</div>
                            <div class="chat-bubble" style="max-width: 100%;">
                                \${attachmentHtml}
                                <div class="chat-text">\${msg.text}</div>
                            </div>
                        </div>
                    \`;
                    chatBox.appendChild(div);
                    
                    const contentArea = document.querySelector('.content-area');
                    contentArea.scrollTop = contentArea.scrollHeight;
                    break;
                    
                case 'studentsList':
                    const ul = document.getElementById('participantsList');
                    ul.innerHTML = '';
                    let count = message.students.length;
                    document.getElementById('siswaCount').innerText = count.toString();
                    
                    if (count === 0) {
                        ul.innerHTML = '<div class="text-muted text-sm text-center" style="margin-top: 20px;">Belum ada partisipan lain.</div>';
                    } else {
                        message.students.forEach(st => {
                            let stAvatar = st.avatar;
                            if (!stAvatar || !stAvatar.startsWith('http')) {
                                stAvatar = \`https://api.dicebear.com/9.x/adventurer/png?seed=\${encodeURIComponent(st.name)}\`;
                            }
                            const li = document.createElement('div');
                            li.className = 'participant-item';
                            
                            let viewBtnHtml = '';
                            if (isHost) {
                                viewBtnHtml = \`
                                    <button class="icon-btn" onclick="vscode.postMessage({ type: 'viewStudentCode', uuid: '\${st.uuid}', name: '\${st.name}' })" title="Lihat Live Code" style="margin-left: auto;">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                                    </button>
                                \`;
                            }
                            
                            li.innerHTML = \`
                                <div class="chat-avatar">
                                    <img src="\${stAvatar}" alt="\${st.name}" />
                                </div>
                                <div class="participant-name">\${st.name}</div>
                                \${viewBtnHtml}
                            \`;
                            ul.appendChild(li);
                        });
                    }
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}
