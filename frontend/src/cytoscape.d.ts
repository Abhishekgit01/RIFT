declare module 'cytoscape' {
  export = cytoscape;
  function cytoscape(options?: any): cytoscape.Core;
  namespace cytoscape {
    interface Core {
      on(event: string, selector: string, handler: (e: any) => void): void;
      on(event: string, handler: (e: any) => void): void;
      destroy(): void;
    }
    interface ElementDefinition {
      data: Record<string, any>;
      position?: { x: number; y: number };
    }
  }
}
