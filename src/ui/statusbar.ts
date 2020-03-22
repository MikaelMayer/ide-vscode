"use strict";
import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient";

import { LanguageServerNotification } from "../stringRessources/languageServer";
import { StatusbarStrings } from "../stringRessources/messages";
import { EnvironmentConfig } from "../stringRessources/commands";

export class Statusbar {
    private dafnyerrors: number | undefined;
    private dafnyversion: string | undefined;
    private activeDocument: vscode.Uri | undefined;
    private serverStatusBar: vscode.StatusBarItem;
    private currentDocumentStatucBar: vscode.StatusBarItem;

    constructor(languageServer: LanguageClient) {
        const priority = 10; 
        this.currentDocumentStatucBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority);
        this.serverStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, priority);

        // Sent once when server has started (and after every server restart has been triggered)
        languageServer.onNotification(LanguageServerNotification.ServerStarted, (serverversion: string) => {
            vscode.window.showInformationMessage(StatusbarStrings.Started)
            this.dafnyversion = serverversion;
            this.update();
        });

        // Set from the verifiaction service; this gets triggered by every server side buffer update 
        languageServer.onNotification(LanguageServerNotification.ActiveVerifiyingDocument, (activeDocument: vscode.Uri) => {
            this.activeDocument = activeDocument;
            this.update();
        });

        // This update gets called by server-side events when new dafny file error informations are available 
        languageServer.onNotification(
            LanguageServerNotification.UpdateStatusbar,
            (countedErrors: number) => {
                this.dafnyerrors = countedErrors; 
                this.update();
            }
        );
    }

    private hide(): void {
        this.serverStatusBar.hide();
        this.currentDocumentStatucBar.hide();
    }

    private show(): void {
        this.serverStatusBar.show();
        this.currentDocumentStatucBar.show();
    }

    public update(): void {
        const editor = vscode.window.activeTextEditor;
        const editorsOpen: number = vscode.window.visibleTextEditors.length;
        if (!editor || editorsOpen === 0 || editor.document.languageId !== EnvironmentConfig.Dafny) {
            this.hide();
        } else {
            this.currentDocumentStatucBar.text = (this.dafnyerrors && this.dafnyerrors > 0)
                ? `${StatusbarStrings.NotVerified} - ${StatusbarStrings.Errors}: ${this.dafnyerrors}`
                : StatusbarStrings.Verified;

            if (this.dafnyversion) {
                this.serverStatusBar.text = `${StatusbarStrings.DafnyVersion}: ${this.dafnyversion.trim()}`;
                this.serverStatusBar.tooltip = this.activeDocument 
                    ? `${StatusbarStrings.CurrentDocument}: ${this.activeDocument.toString()}` 
                    : StatusbarStrings.NoDocumentSelected;
    
            } else {
                this.currentDocumentStatucBar.text = StatusbarStrings.Pending;
            }
            this.show();
        }
    }
}
