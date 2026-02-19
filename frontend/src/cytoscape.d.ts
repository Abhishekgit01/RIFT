declare module 'cytoscape' {
  export = cytoscape;
  function cytoscape(options?: any): cytoscape.Core;
  namespace cytoscape {
    interface Core {
      on(event: string, selector: string, handler: (e: any) => void): void;
      on(event: string, handler: (e: any) => void): void;
      destroy(): void;
      elements(selector?: string): any;
      nodes(selector?: string): any;
      edges(selector?: string): any;
      animate(options: any): any;
      fit(eles?: any, padding?: number): any;
      zoom(level?: number): any;
      center(eles?: any): any;
      pan(pos?: { x: number; y: number }): any;
      extent(): any;
      getElementById(id: string): any;
    }
    interface ElementDefinition {
      data: Record<string, any>;
      position?: { x: number; y: number };
    }
  }
}
