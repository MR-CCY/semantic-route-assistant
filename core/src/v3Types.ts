export type SymbolRecord = {
  symbolId: string;
  signature: string;
  declHash: string;
  implHash: string;
  brief: string;
  filePath: string;
  pathModuleHint: string;
  tags: string[];
};

export type Cluster = {
  clusterId: string;
  title: string;
  description: string;
  symbols: SymbolRecord[];
};
