import { ExtensionContext, Disposable } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node';

import Configuration from '../configuration';
import { ConfigurationConstants } from '../constants';
import { getDotnetExecutablePath } from '../dotnet';
import { DafnyDocumentFilter } from '../tools/vscode';
import { ICompilationStatusParams, IVerificationCompletedParams, IVerificationStartedParams } from './api/compilationStatus';
import { ICounterExampleItem, ICounterExampleParams } from './api/counterExample';
import { IGhostDiagnosticsParams } from './api/ghostDiagnostics';
import { IVerificationDiagnosticsParams } from './api/verificationDiagnostics';
import { IVerificationIntermediateParams } from './api/verificationIntermediate';
import { getLanguageServerRuntimePath } from './dafnyInstallation';

const LanguageServerId = 'dafny-vscode';
const LanguageServerName = 'Dafny Language Server';

function getLanguageServerLaunchArgs(): string[] {
  const launchArgs = Configuration.get<string[]>(ConfigurationConstants.LanguageServer.LaunchArgs);
  return [
    getVerificationArgument(),
    getVerifierTimeLimitArgument(),
    getVerifierVirtualCoresArgument(),
    getMarkGhostStatementsArgument(),
    ...launchArgs
  ];
}

function getVerificationArgument(): string {
  return `--documents:verify=${Configuration.get<string>(ConfigurationConstants.LanguageServer.AutomaticVerification)}`;
}

function getVerifierTimeLimitArgument(): string {
  return `--verifier:timelimit=${Configuration.get<string>(ConfigurationConstants.LanguageServer.VerificationTimeLimit)}`;
}

function getVerifierVirtualCoresArgument(): string {
  return `--verifier:vcscores=${Configuration.get<string>(ConfigurationConstants.LanguageServer.VerificationVirtualCores)}`;
}

function getMarkGhostStatementsArgument(): string {
  return `--ghost:markStatements=${Configuration.get<string>(ConfigurationConstants.LanguageServer.MarkGhostStatements)}`;
}

export class DafnyLanguageClient extends LanguageClient {
  // eslint-disable-next-line max-params
  private constructor(id: string, name: string, serverOptions: ServerOptions, clientOptions: LanguageClientOptions, forceDebug?: boolean) {
    super(id, name, serverOptions, clientOptions, forceDebug);
  }

  public getCounterExamples(param: ICounterExampleParams): Promise<ICounterExampleItem[]> {
    return this.sendRequest<ICounterExampleItem[]>('dafny/counterExample', param);
  }

  public static async create(context: ExtensionContext): Promise<DafnyLanguageClient> {
    const dotnetExecutable = await getDotnetExecutablePath();
    const launchArguments = [ getLanguageServerRuntimePath(context), ...getLanguageServerLaunchArgs() ];
    const serverOptions: ServerOptions = {
      run: { command: dotnetExecutable, args: launchArguments },
      debug: { command: dotnetExecutable, args: launchArguments }
    };
    const clientOptions: LanguageClientOptions = {
      documentSelector: [ DafnyDocumentFilter ],
      diagnosticCollectionName: LanguageServerId
    };
    return new DafnyLanguageClient(LanguageServerId, LanguageServerName, serverOptions, clientOptions);
  }

  public onGhostDiagnostics(callback: (params: IGhostDiagnosticsParams) => void): Disposable {
    return this.onNotification('dafny/ghost/diagnostics', callback);
  }

  public onVerificationDiagnostics(callback: (params: IVerificationDiagnosticsParams) => void): Disposable {
    return this.onNotification('dafny/verification/diagnostics', callback);
  }

  public onVerificationIntermediate(callback: (params: IVerificationIntermediateParams) => void): Disposable {
    return this.onNotification('dafny/verification/intermediate', callback);
  }

  public onCompilationStatus(callback: (params: ICompilationStatusParams) => void): Disposable {
    return this.onNotification('dafny/compilation/status', callback);
  }

  public onServerVersion(callback: (version: string) => void): Disposable {
    return this.onNotification('dafnyLanguageServerVersionReceived', callback);
  }

  // TODO Legacy verification status messages
  public onVerificationStarted(callback: (params: IVerificationStartedParams) => void): Disposable {
    return this.onNotification('dafny/verification/started', callback);
  }

  public onVerificationCompleted(callback: (params: IVerificationCompletedParams) => void): Disposable {
    return this.onNotification('dafny/verification/completed', callback);
  }
}
