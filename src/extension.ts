import * as vscode from 'vscode';
import { ClassroomService, ClassroomStatus, ClassroomEvent } from './classroomService';
import { RakodaRoomViewProvider } from './RakodaRoomViewProvider';

class LiveCodeProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    public readonly onDidChange = this._onDidChange.event;
    private contents = new Map<string, string>();

    public provideTextDocumentContent(uri: vscode.Uri): string {
        return this.contents.get(uri.toString()) || '';
    }

    public update(uri: vscode.Uri, content: string) {
        this.contents.set(uri.toString(), content);
        this._onDidChange.fire(uri);
    }
}

export async function activate(context: vscode.ExtensionContext) {
    const classroomService = ClassroomService.getInstance();
    await classroomService.initIdentity(context);

    const provider = new RakodaRoomViewProvider(context.extensionUri, classroomService, context);
    
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            RakodaRoomViewProvider.viewType, 
            provider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    const liveCodeProvider = new LiveCodeProvider();
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('rakoda-live', liveCodeProvider)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('rakodaRoom.host', async () => {
            const customCode = await vscode.window.showInputBox({ prompt: 'Custom Room Code (Opsional)' });
            try {
                await classroomService.hostRoom(customCode);
                vscode.window.showInformationMessage(`Hosted Room: ${classroomService.roomCode}`);
            } catch (e: any) {
                vscode.window.showErrorMessage(`Failed to host room: ${e.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('rakodaRoom.join', async () => {
            const code = await vscode.window.showInputBox({ prompt: 'Masukkan Room Code' });
            if (code) {
                try {
                    await classroomService.joinRoom(code);
                    vscode.window.showInformationMessage(`Berhasil bergabung ke Room: ${code}`);
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Gagal bergabung: ${e.message}`);
                }
            }
        })
    );

    // Listen to incoming messages for live code sharing
    context.subscriptions.push(
        classroomService.onMessage(async (msg: ClassroomEvent) => {
            if (msg.eventType === 'live_code' && !classroomService.isHost) {
                const uri = vscode.Uri.parse(`rakoda-live://teacher/LiveCode_Guru.txt`);
                liveCodeProvider.update(uri, msg.text || '');
                
                let editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString());
                if (!editor) {
                    try {
                        const doc = await vscode.workspace.openTextDocument(uri);
                        editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true, preview: true });
                    } catch (e) {}
                }
                
                if (editor && msg.selectionStart !== undefined && msg.selectionEnd !== undefined) {
                    try {
                        const startPos = editor.document.positionAt(msg.selectionStart);
                        const endPos = editor.document.positionAt(msg.selectionEnd);
                        editor.selections = [new vscode.Selection(startPos, endPos)];
                        editor.revealRange(new vscode.Range(startPos, endPos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
                    } catch(e) {}
                }
                
            } else if (msg.eventType === 'student_live_code' && classroomService.isHost) {
                const safeName = (msg.name || 'Unknown').replace(/\\s+/g, '_');
                const uri = vscode.Uri.parse(`rakoda-live://student/LiveCode_${safeName}.txt`);
                liveCodeProvider.update(uri, msg.text || '');
                
                let editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString());
                if (!editor) {
                    try {
                        const doc = await vscode.workspace.openTextDocument(uri);
                        editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true, preview: true });
                    } catch (e) {}
                }
                
                if (editor && msg.selectionStart !== undefined && msg.selectionEnd !== undefined) {
                    try {
                        const startPos = editor.document.positionAt(msg.selectionStart);
                        const endPos = editor.document.positionAt(msg.selectionEnd);
                        editor.selections = [new vscode.Selection(startPos, endPos)];
                        editor.revealRange(new vscode.Range(startPos, endPos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
                    } catch(e) {}
                }
                
            } else if (msg.eventType === 'request_code_stream' && !classroomService.isHost) {
                if (msg.uuid === classroomService.identityUuid) {
                    classroomService.isBroadcastingToHost = (msg.text === 'true');
                    if (classroomService.isBroadcastingToHost) {
                        const editor = vscode.window.activeTextEditor;
                        if (editor && editor.document.uri.scheme !== 'rakoda-live') {
                            const text = editor.document.getText();
                            const selection = editor.selection;
                            const offsetStart = editor.document.offsetAt(selection.start);
                            const offsetEnd = editor.document.offsetAt(selection.end);
                            classroomService.sendStudentLiveCode(text, offsetStart, offsetEnd);
                        }
                    }
                }
            }
        })
    );

    // Listen to local text changes and broadcast
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((e) => {
            const editor = vscode.window.activeTextEditor;
            if (editor && e.document === editor.document && e.document.uri.scheme !== 'rakoda-live') {
                const text = e.document.getText();
                const selection = editor.selection;
                const offsetStart = e.document.offsetAt(selection.start);
                const offsetEnd = e.document.offsetAt(selection.end);

                if (classroomService.isHost) {
                    classroomService.broadcastLiveCode(text, offsetStart, offsetEnd);
                } else if (classroomService.isBroadcastingToHost) {
                    classroomService.sendStudentLiveCode(text, offsetStart, offsetEnd);
                }
            }
        })
    );

    // Listen to selection changes
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection((e) => {
            if (e.textEditor === vscode.window.activeTextEditor && e.textEditor.document.uri.scheme !== 'rakoda-live') {
                const text = e.textEditor.document.getText();
                const offsetStart = e.textEditor.document.offsetAt(e.selections[0].start);
                const offsetEnd = e.textEditor.document.offsetAt(e.selections[0].end);

                if (classroomService.isHost) {
                    classroomService.broadcastLiveCode(text, offsetStart, offsetEnd);
                } else if (classroomService.isBroadcastingToHost) {
                    classroomService.sendStudentLiveCode(text, offsetStart, offsetEnd);
                }
            }
        })
    );
}

export function deactivate() {
    ClassroomService.getInstance().disconnect();
}

