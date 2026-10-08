/**
 * Ambient type declarations for Office.js & Excel API.
 * Provides fallback definitions before or alongside @types/office-js.
 */

declare namespace Excel {
  interface RequestContext {
    workbook: {
      worksheets: any;
      tables: any;
      getSelectedRange(): any;
    };
    sync(): Promise<void>;
  }

  interface Worksheet {
    [key: string]: any;
  }

  interface Range {
    [key: string]: any;
    values: any;
    format: any;
  }

  function run<T>(batch: (context: RequestContext) => Promise<T>): Promise<T>;
}

declare namespace Office {
  const context: any;
  function onReady(callback?: (info: any) => any): Promise<any>;
  namespace AddinCommands {
    interface Event {
      completed(): void;
      [key: string]: any;
    }
  }
}
