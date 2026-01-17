export type SymbolRecord = {
  symbolId: string;
  signature: string;
  declHash: string;
  implHash: string;
  brief: string;
  filePath: string;
  declLine?: number;
  implLine?: number;
  pathModuleHint: string;
  baseTags: string[];
  semanticTags: string[];
};

export type Cluster = {
  clusterId: string;
  title: string;
  description: string;
  symbols: SymbolRecord[];
};
