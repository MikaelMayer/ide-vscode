/* eslint-disable max-depth */
import { /*commands, */DecorationOptions, Range, window, ExtensionContext, workspace, TextEditor, /*languages, Hover, TextDocument, Selection, CodeActionContext, ProviderResult, Command, CodeAction, CodeActionKind, WorkspaceEdit, Position,*/ TextEditorDecorationType, TextEditorSelectionChangeEvent, Position } from 'vscode';
import { /*CancellationToken, */Diagnostic, Disposable } from 'vscode-languageclient';
//import { LanguageConstants } from '../constants';

import { IVerificationDiagnosticsParams, LineVerificationStatus } from '../language/api/verificationDiagnostics';
import { DafnyLanguageClient } from '../language/dafnyLanguageClient';
import { getVsDocumentPath, toVsRange } from '../tools/vscode';

interface ErrorGraph {
  [line: number]: Map<Range, Range[]>;
}

/*// TODO: Find a way to not depend on this function
function rangeOf(r: any): Range {
  return new Range(
    new Position(r.start.line, r.start.character),
    new Position(r.end.line, r.end.character));
}*/

type DecorationType = undefined | {
  type: 'static',
  path: string,
  icon: TextEditorDecorationType
} | {
  type: 'dynamic',
  paths: string[],
  icons: TextEditorDecorationType[]
};

// Indexed by LineVerificationStatus
type DecorationSet = Map<LineVerificationStatus, DecorationType>;

interface DecorationSetRanges {
  // First array indexed by LineVerificationStatus
  decorations: Range[][];
}
interface LinearVerificationDiagnostics extends DecorationSetRanges {
  errorGraph: ErrorGraph;
}

export default class VerificationDiagnosticsView {
  private readonly normalDecorations: DecorationSet;
  private readonly grayedeDecorations: DecorationSet;
  private readonly relatedDecorations: TextEditorDecorationType;
  private readonly relatedDecorationsPartial: TextEditorDecorationType;
  private readonly relatedDecorationsPartialActive: TextEditorDecorationType;
  private readonly textEditorWatcher?: Disposable;

  private readonly dataByDocument = new Map<string, LinearVerificationDiagnostics>();
  private animationCallback: unknown = 0;
  // Alternates between 0 and 1
  private animationFrame: number = 0;

  private static readonly emptyLinearVerificationDiagnostics: Range[][]
    = Array(LineVerificationStatus.NumberOfLineDiagnostics).fill([]);

  private constructor(context: ExtensionContext) {
    function iconOf(path: string): TextEditorDecorationType {
      const icon = context.asAbsolutePath(`images/${path}.png`);
      return window.createTextEditorDecorationType({
        isWholeLine: true,
        rangeBehavior: 1,
        gutterIconPath: icon
      });
    }
    function makeIcon(...paths: string[]): DecorationType {
      if(paths.length === 1) {
        return { type: 'static', path: paths[0], icon: iconOf(paths[0]) };
      } else if(paths.length > 1) {
        return { type: 'dynamic', paths: paths, icons: paths.map(path => iconOf(path)) };
      } else {
        return undefined;
      }
    }
    this.normalDecorations = new Map<LineVerificationStatus, DecorationType>([
      [ LineVerificationStatus.Scheduled, makeIcon('scheduled') ],
      [ LineVerificationStatus.Error, makeIcon('error') ],
      [ LineVerificationStatus.ErrorObsolete, makeIcon('error-obsolete') ],
      [ LineVerificationStatus.ErrorVerifying, makeIcon('error-verifying', 'error-verifying-2') ],
      [ LineVerificationStatus.ErrorRange, makeIcon('error-range') ],
      [ LineVerificationStatus.ErrorRangeStart, makeIcon('error-range-start') ],
      [ LineVerificationStatus.ErrorRangeStartObsolete, makeIcon('error-range-start-obsolete') ],
      [ LineVerificationStatus.ErrorRangeStartVerifying, makeIcon('error-range-start-verifying', 'error-range-start-verifying-2') ],
      [ LineVerificationStatus.ErrorRangeEnd, makeIcon('error-range-end') ],
      [ LineVerificationStatus.ErrorRangeEndObsolete, makeIcon('error-range-end-obsolete') ],
      [ LineVerificationStatus.ErrorRangeEndVerifying, makeIcon('error-range-end-verifying', 'error-range-end-verifying-2') ],
      [ LineVerificationStatus.ErrorRangeObsolete, makeIcon('error-range-obsolete') ],
      [ LineVerificationStatus.ErrorRangeVerifying, makeIcon('error-range-verifying', 'error-range-verifying-2') ],
      [ LineVerificationStatus.VerifiedObsolete, makeIcon('verified-obsolete') ],
      [ LineVerificationStatus.VerifiedVerifying, makeIcon('verified-verifying', 'verified-verifying-2') ],
      [ LineVerificationStatus.Verified, makeIcon('verified') ],
      [ LineVerificationStatus.Verifying, makeIcon('verifying', 'verifying-2') ],
      [ LineVerificationStatus.ResolutionError, makeIcon('resolution-error') ]
    ]);
    this.grayedeDecorations = new Map<LineVerificationStatus, DecorationType>([
      [ LineVerificationStatus.Scheduled, makeIcon('scheduled') ],
      [ LineVerificationStatus.Error, makeIcon('error_gray') ],
      [ LineVerificationStatus.ErrorObsolete, makeIcon('error-obsolete_gray') ],
      [ LineVerificationStatus.ErrorVerifying, makeIcon('error-verifying_gray') ],
      [ LineVerificationStatus.ErrorRange, makeIcon('error-range_gray') ],
      [ LineVerificationStatus.ErrorRangeStart, makeIcon('error-range-start_gray') ],
      [ LineVerificationStatus.ErrorRangeStartObsolete, makeIcon('error-range-start_gray') ],
      [ LineVerificationStatus.ErrorRangeStartVerifying, makeIcon('error-range-start_gray') ],
      [ LineVerificationStatus.ErrorRangeEnd, makeIcon('error-range-end_gray') ],
      [ LineVerificationStatus.ErrorRangeEndObsolete, makeIcon('error-range-end_gray') ],
      [ LineVerificationStatus.ErrorRangeEndVerifying, makeIcon('error-range-end_gray') ],
      [ LineVerificationStatus.ErrorRangeObsolete, makeIcon('error-range-obsolete_gray') ],
      [ LineVerificationStatus.ErrorRangeVerifying, makeIcon('error-range-verifying_gray') ],
      [ LineVerificationStatus.VerifiedObsolete, makeIcon('verified_gray') ],
      [ LineVerificationStatus.VerifiedVerifying, makeIcon('verified_gray') ],
      [ LineVerificationStatus.Verified, makeIcon('verified_gray') ],
      [ LineVerificationStatus.Verifying, makeIcon('verified_gray') ],
      [ LineVerificationStatus.ResolutionError, makeIcon('resolution-error') ]
    ]);
    // For dynamic error highlighting
    this.relatedDecorations = window.createTextEditorDecorationType({
      isWholeLine: false,
      rangeBehavior: 1,
      outline: '#fe536aa0 2px solid'
      // textDecoration: 'underline overline #fe536ac0'
      // backgroundColor: '#fe536a50'
    });
    this.relatedDecorationsPartial = window.createTextEditorDecorationType({
      isWholeLine: false,
      rangeBehavior: 1,
      outline: '#fe536aa0 2px dashed'
      // textDecoration: 'underline overline #fe536ac0'
      // backgroundColor: '#fe536a50'
    });
    this.relatedDecorationsPartialActive = window.createTextEditorDecorationType({
      isWholeLine: false,
      rangeBehavior: 1,
      outline: '#fe536a 2px dashed'
      // textDecoration: 'underline overline #fe536ac0'
      // backgroundColor: '#fe536a50'
    });
    this.textEditorWatcher = window.onDidChangeTextEditorSelection((e) => this.onTextChange(e, false));
  }

  public static createAndRegister(context: ExtensionContext, languageClient: DafnyLanguageClient): VerificationDiagnosticsView {
    const instance = new VerificationDiagnosticsView(context);
    context.subscriptions.push(
      workspace.onDidCloseTextDocument(document => instance.clearVerificationDiagnostics(document.uri.toString())),
      window.onDidChangeActiveTextEditor(editor => instance.refreshDisplayedVerificationDiagnostics(editor)),
      languageClient.onVerificationDiagnostics(params => instance.updateVerificationDiagnostics(params))
    );
    /*languages.registerHoverProvider(LanguageConstants.Id, {
      provideHover(document, position, token) {
        instance.onTextChange(position.line, token);
        return null;
        //return new Hover('I am a hover!');
      }
    });*/
    // Quick code fix
    //languages.registerCodeActionsProvider(LanguageConstants.Id, instance);
    return instance;
  }
  /*
  public rangeOfClosingBrace(document: TextDocument, originalRange: Range): { range: Range, indent: number } | undefined {
    let tmpRange = new Range(originalRange.start, new Position(originalRange.start.line + 1, 0));
    let documentText = document.getText(tmpRange).substring(1);
    let braceNumber = 1;
    let i = 0;
    let lastIndentBeforeBrace = 0;
    let first = true;
    let onlySpaces = true;
    let lastIndent = 0;
    while(documentText != null && documentText != '') {
      while(i < documentText.length && braceNumber != 0) {
        if(documentText[i] == '{') braceNumber++;
        if(documentText[i] == '}') braceNumber--;
        i++;
        if(!first && onlySpaces) {
          if(documentText[i] == ' ') {
            lastIndent = i;
          } else {
            onlySpaces = false;
          }
        }
      }
      if(braceNumber !== 0) {
        lastIndentBeforeBrace = lastIndent;
        tmpRange = new Range(tmpRange.end.line, tmpRange.end.character, tmpRange.end.line + 1, 0);
        documentText = document.getText(tmpRange);
        i = 0;
        first = false;
        onlySpaces = true;
        continue;
      } else {
        break;
      }
    }
    if(braceNumber == 0) {
      return {
        range: new Range(
          new Position(tmpRange.start.line, tmpRange.start.character + i - 1),
          new Position(tmpRange.start.line, tmpRange.start.character + i)),
        indent: lastIndentBeforeBrace + 1 };
    } else {
      return undefined;
    }
  }
*/
  /*
  public provideCodeActions(document: TextDocument, range: Range | Selection, context: CodeActionContext, token: CancellationToken): ProviderResult<CodeAction[]> {
    // If it's a related condition, try to inline it.
    const documentPath = document.uri.toString();
    const data = this.dataByDocument.get(documentPath);
    if(data == null || data.errorGraph == null) {
      return undefined;
    }
    const errorGraph = data.errorGraph;
    const line = range.start.line;
    if(errorGraph[line] == null || !errorGraph.fixableErrors[line]) {
      return undefined;
    }
    const codeActions = [];
    const originalRange = errorGraph.fixableErrors[line];
    for(const relatedRange of errorGraph[line]) {
      if(relatedRange == null) continue;
      // FIXME: Have the range already report the range of the expression, do not guess it !
      const relatedRangeExtended = new Range(
        relatedRange.start,
        new Position(relatedRange.end.line, 9993)
      );

      const originalBrace = document.getText(originalRange);
      if(originalBrace != '{') continue;
      const closingBraceIndent = this.rangeOfClosingBrace(document, originalRange);
      if(closingBraceIndent == undefined) continue;
      let { range: closingBrace, indent: indent } = closingBraceIndent;
      indent = Math.max(indent, closingBrace.start.character + 2);
      const indentationBrace = ' '.repeat(closingBrace.start.character);
      const missingChars = ' '.repeat(indent - closingBrace.start.character);
      const textToInsert = document.getText(relatedRangeExtended);
      const codeAction = new CodeAction(
        'Inline failing \'' + textToInsert
        + '\' of line ' + relatedRange.start.line + ' (experimental)',
        CodeActionKind.RefactorInline);
      codeAction.edit = new WorkspaceEdit();
      codeAction.edit.insert(document.uri, closingBrace.start, missingChars + 'assert ' + textToInsert + ';\n' + indentationBrace);
      codeActions.push(codeAction);
      break; // Let's offer to inline only one
    }
    return codeActions;
  }
*/
  /////////////////// Related error rendering ///////////////////
  private rangeDistance(range1: Range, range2: Range): number {
    if(range1.intersection(range2)?.isEmpty === false
       || range1.contains(range2)
       || range2.contains(range1)) {
      return 0;
    }
    if(range1.end.line < range2.start.line) {
      return (range2.start.line - range1.end.line) * 1000;
    } else if(range2.end.line < range1.start.line) {
      return (range1.start.line - range2.end.line) * 1000;
    } else {
      // Same line
      if(range1.end.character < range2.start.character) {
        return range2.start.character - range1.end.character;
      } else {
        return range1.start.character - range2.end.character;
      }
    }
  }

  private readonly lastResolvedDocumentStates: Map<string, string> = new Map();

  public onTextChange(e: TextEditorSelectionChangeEvent | undefined = undefined, storeDocumentState: boolean = false): void {
    const editor: TextEditor | undefined = window.activeTextEditor;
    if(editor == null) {
      return;
    }
    const documentPath = editor.document.uri.toString();
    const data = this.dataByDocument.get(documentPath);
    const currentText = editor.document.getText();
    // Only works if we have the same text as the last resolved document states
    if(this.lastResolvedDocumentStates.get(documentPath) !== currentText) {
      if(storeDocumentState) {
        this.lastResolvedDocumentStates.set(documentPath, currentText);
      } else {
        return;
      }
    }

    const resetRelatedDecorations = () => {
      editor.setDecorations(this.relatedDecorations, []);
      editor.setDecorations(this.relatedDecorationsPartial, []);
      editor.setDecorations(this.relatedDecorationsPartialActive, []);
    };
    if(data == null || data.decorations[LineVerificationStatus.ResolutionError].length > 0) {
      resetRelatedDecorations();
      return;
    }
    const errorGraph = data.errorGraph;
    const selection = e === undefined ? editor.selection : e.selections[0];
    const line = selection.start.line;
    const errorGraphLine = errorGraph[line];
    if(errorGraphLine == null) {
      resetRelatedDecorations();
      return;
    }
    // Highlights all ranges on the line
    // Highlights ranges under cursor and dependency with active highlighting
    const keys = [ ...errorGraphLine.keys() ];
    if(keys.length === 0) {
      resetRelatedDecorations();
      return;
    }

    // Determine which keys is the closest to the selection.
    const closestKey = this.closestRange(selection, keys);
    const ranges = [], partialRanges = [], partialActiveRanges = [];
    for(const key of keys) {
      const closest = closestKey === key;
      const relatedRanges = errorGraphLine.get(key) ?? [];
      if(relatedRanges.length <= 1) {
        ranges.push(key);
      } else { // Partial error
        if(closest || keys.length === 1) {
          partialActiveRanges.push(key);
          partialActiveRanges.push(...relatedRanges);
        } else {
          partialRanges.push(key);
        }
      }
    }
    editor.setDecorations(this.relatedDecorations, ranges);
    editor.setDecorations(this.relatedDecorationsPartial, partialRanges);
    editor.setDecorations(this.relatedDecorationsPartialActive, partialActiveRanges);
  }

  private closestRange(selection: Range, ranges: Range[]) {
    let closestKey = ranges[0];
    let currentDistance = -1;
    for(const key of ranges) {
      const newDistance = this.rangeDistance(key, selection);
      if(newDistance < currentDistance || currentDistance < 0) {
        closestKey = key;
        currentDistance = newDistance;
      }
    }
    return closestKey;
  }

  /////////////////// Gutter rendering ///////////////////

  private animateIcon(editor: TextEditor, iconFrames: TextEditorDecorationType[], ranges: Range[]) {
    for(let i = 0; i < iconFrames.length; i++) {
      editor.setDecorations(iconFrames[i], this.animationFrame === i ? ranges : []);
    }
  }

  public refreshDisplayedVerificationDiagnostics(editor?: TextEditor, animateOnly: boolean = false): void {
    if(editor == null) {
      return;
    }
    if(!animateOnly) {
      this.onTextChange(undefined, true);
    }
    const documentPath = editor.document.uri.toString();
    const originalData = this.dataByDocument.get(documentPath);
    if(originalData == null) {
      return;
    }
    const resolutionFailed = originalData.decorations[LineVerificationStatus.ResolutionError].length > 0;
    const decorationSets: { decorationSet: DecorationSet, active: boolean }[]
      = [
        { decorationSet: this.normalDecorations, active: !resolutionFailed },
        { decorationSet: this.grayedeDecorations, active: resolutionFailed } ];

    for(const { decorationSet, active } of decorationSets) {
      const decorations: Range[][] = active ? originalData.decorations : VerificationDiagnosticsView.emptyLinearVerificationDiagnostics;
      for(let lineVerificationStatus = 0; lineVerificationStatus < LineVerificationStatus.NumberOfLineDiagnostics; lineVerificationStatus++) {
        const ranges = decorations[lineVerificationStatus];
        const decorationType = decorationSet.get(lineVerificationStatus);
        if(decorationType === undefined) {
          continue;
        } else if(decorationType.type === 'static' && !animateOnly) {
          editor.setDecorations(decorationType.icon, ranges);
        } else if(decorationType.type === 'dynamic') {
          this.animateIcon(editor, decorationType.icons, ranges);
        }
      }
    }
  }

  private clearVerificationDiagnostics(documentPath: string): void {
    const data = this.dataByDocument.get(documentPath);
    if(data != null) {
      //data.decoration.dispose();
      this.dataByDocument.delete(documentPath);
    }
  }
  private rangesIntersect(range1: Range, range2: Range): boolean {
    return range1.start.line <= range2.end.line && range1.end.line >= range2.start.line;
  }

  private addEntry(errorGraph: ErrorGraph, range1: Range, range2: Range | null) {
    const line = range1.start.line;
    if(errorGraph[line] === undefined) {
      errorGraph[line] = new Map();
    }
    if(range2 != null) {
      errorGraph[line].set(range1, (errorGraph[line].get(range1) ?? []).concat([ range2 ]));
    }
  }

  private isNotErrorLine(diagnostic: LineVerificationStatus): boolean {
    return (diagnostic === LineVerificationStatus.Scheduled
      || diagnostic === LineVerificationStatus.Unknown
      || diagnostic === LineVerificationStatus.Verified
      || diagnostic === LineVerificationStatus.VerifiedObsolete
      || diagnostic === LineVerificationStatus.VerifiedVerifying
      || diagnostic === LineVerificationStatus.Verifying);
  }

  private addCosmetics(lineDiagnostics: LineVerificationStatus[]): LineVerificationStatus[] {
    let previousLineDiagnostic = LineVerificationStatus.Verified;
    let direction = 1;
    for(let line = 0; line >= 0; line += direction) {
      if(line === lineDiagnostics.length) {
        direction = -1;
        previousLineDiagnostic = LineVerificationStatus.Verified;
        continue;
      }
      const lineDiagnostic = lineDiagnostics[line];
      if(this.isNotErrorLine(previousLineDiagnostic)) {
        if(lineDiagnostic === LineVerificationStatus.ErrorRange) {
          lineDiagnostics[line] = direction === 1 ? LineVerificationStatus.ErrorRangeStart : LineVerificationStatus.ErrorRangeEnd;
        } else if(lineDiagnostic === LineVerificationStatus.ErrorRangeObsolete) {
          lineDiagnostics[line] = direction === 1 ? LineVerificationStatus.ErrorRangeStartObsolete : LineVerificationStatus.ErrorRangeEndObsolete;
        } else if(lineDiagnostic === LineVerificationStatus.ErrorRangeVerifying) {
          lineDiagnostics[line] = direction === 1 ? LineVerificationStatus.ErrorRangeStartVerifying : LineVerificationStatus.ErrorRangeEndVerifying;
        }
      }
      previousLineDiagnostic = lineDiagnostic;
    }
    return lineDiagnostics;
  }
  // TODO: Find a way to not depend on this function
  private rangeOf(r: any): Range {
    return new Range(
      new Position(r.start.line, r.start.character),
      new Position(r.end.line, r.end.character));
  }

  // For every error and related error, returns a mapping from line to affected ranges
  private getErrorGraph(params: IVerificationDiagnosticsParams): ErrorGraph {
    const diagnostics: Diagnostic[] = params.diagnostics;
    const errorGraph: ErrorGraph = {
    };
    for(const diagnostic of diagnostics) {
      const range = this.rangeOf(diagnostic.range);
      this.addEntry(errorGraph, range, range);
      if(Array.isArray(diagnostic.relatedInformation)) {
        for(const relatedInformation of diagnostic.relatedInformation as any[]) {
          const location = relatedInformation.location;
          if(location == null || location.range == null) {
            continue;
          }
          const locationRange = this.rangeOf(location.range);
          if(params.uri === location.uri) {
            this.addEntry(errorGraph, range, locationRange);
            this.addEntry(errorGraph, locationRange, range);
            this.addEntry(errorGraph, locationRange, locationRange);
          }
        }
      }
    }
    return errorGraph;
  }

  private getRangesOfLineStatus(params: IVerificationDiagnosticsParams): Range[][] {
    //// Per-line diagnostics
    const lineDiagnostics = this.addCosmetics(params.perLineDiagnostic);

    let previousLineDiagnostic = -1;
    let initialDiagnosticLine = -1;
    const ranges: Range[][] = Array(LineVerificationStatus.NumberOfLineDiagnostics);
    for(let i = 0; i < ranges.length; i++) {
      ranges[i] = [];
    }

    // <= so that we add a virtual final line to commit the last range.
    for(let line = 0; line <= lineDiagnostics.length; line++) {
      const lineDiagnostic = line === lineDiagnostics.length ? -1 : lineDiagnostics[line];
      if(lineDiagnostic !== previousLineDiagnostic) {
        if(previousLineDiagnostic !== -1) { // Never assigned before
          const range = new Range(initialDiagnosticLine, 1, line - 1, 1);
          ranges[previousLineDiagnostic].push(range);
        }
        previousLineDiagnostic = lineDiagnostic;
        initialDiagnosticLine = line;
      } else {
        // Just continue
      }
    }
    return ranges;
  }

  private updateVerificationDiagnostics(params: IVerificationDiagnosticsParams): void {
    const documentPath = getVsDocumentPath(params);
    //this.clearVerificationDiagnostics(documentPath);

    const errorGraph = this.getErrorGraph(params);
    const ranges = this.getRangesOfLineStatus(params);

    const newData: LinearVerificationDiagnostics = {
      decorations: ranges,
      errorGraph: errorGraph };

    this.setDisplayedVerificationDiagnostics(documentPath, newData);
  }

  private static readonly obsoleteLineVerificationStatus: LineVerificationStatus[] = [
    LineVerificationStatus.ErrorObsolete,
    LineVerificationStatus.VerifiedObsolete,
    LineVerificationStatus.ErrorRangeObsolete,
    LineVerificationStatus.ErrorRangeStartObsolete,
    LineVerificationStatus.ErrorRangeEndObsolete
  ];
  private static readonly verifyingLineVerificationStatus: LineVerificationStatus[] = [
    LineVerificationStatus.Verifying,
    LineVerificationStatus.ErrorVerifying,
    LineVerificationStatus.ErrorRangeEndVerifying,
    LineVerificationStatus.ErrorRangeVerifying,
    LineVerificationStatus.ErrorRangeStartVerifying,
    LineVerificationStatus.VerifiedVerifying
  ];

  // Takes care of delaying the display of verification diagnostics to not interfere with UX.
  private setDisplayedVerificationDiagnostics(documentPath: string, newData: LinearVerificationDiagnostics) {
    const previousValue = this.dataByDocument.get(documentPath);
    const ranges = newData.decorations;
    clearInterval(this.animationCallback as any);
    const mustBeDelayed = (ranges: Range[][], previousRanges: Range[][]) => (
      (ranges[LineVerificationStatus.ResolutionError].length >= 1
          && previousRanges[LineVerificationStatus.ResolutionError].length === 0)
      || (VerificationDiagnosticsView.obsoleteLineVerificationStatus.some(status => ranges[status].length >= 1)
          && VerificationDiagnosticsView.verifyingLineVerificationStatus.every(status => ranges[status].length === 0)
          && VerificationDiagnosticsView.obsoleteLineVerificationStatus.every(status => previousRanges[status].length === 0)
      )
    );
    if(mustBeDelayed(ranges, (previousValue === undefined ? VerificationDiagnosticsView.emptyLinearVerificationDiagnostics : previousValue.decorations))) {
      // Delay for 1 second resolution errors so that we don't interrupt the verification workflow if not necessary.
      this.animationCallback = setTimeout(() => {
        this.dataByDocument.set(documentPath, newData);
        this.refreshDisplayedVerificationDiagnostics(window.activeTextEditor);
      }, 2000);
    } else {
      this.dataByDocument.set(documentPath, newData);
      this.refreshDisplayedVerificationDiagnostics(window.activeTextEditor);
    }
    // Animated properties
    if(ranges[LineVerificationStatus.Verifying].length > 0
      || ranges[LineVerificationStatus.VerifiedVerifying].length > 0
      || ranges[LineVerificationStatus.ErrorVerifying].length > 0
      || ranges[LineVerificationStatus.ErrorRangeVerifying].length > 0
      || ranges[LineVerificationStatus.ErrorRangeStartVerifying].length > 0
      || ranges[LineVerificationStatus.ErrorRangeStartVerifying].length > 0) {
      this.animationCallback = setInterval(() => {
        this.animationFrame = 1 - this.animationFrame;
        this.refreshDisplayedVerificationDiagnostics(window.activeTextEditor, true);
      }, 200);
    }
  }

  private static createDecorator(diagnostic: Diagnostic): DecorationOptions {
    return {
      range: toVsRange(diagnostic.range),
      hoverMessage: diagnostic.message
    };
  }

  public dispose(): void {
    if(this.textEditorWatcher) {
      this.textEditorWatcher.dispose();
    }
    for(const [ _, decoration ] of this.normalDecorations) {
      if(decoration === undefined) {
        continue;
      } else if(decoration.type === 'static') {
        decoration.icon.dispose();
      } else if(decoration.type === 'dynamic') {
        decoration.icons.forEach(icon => icon.dispose());
      }
    }
    this.relatedDecorations.dispose();
    this.relatedDecorationsPartial.dispose();
    this.relatedDecorationsPartialActive.dispose();
  }
}