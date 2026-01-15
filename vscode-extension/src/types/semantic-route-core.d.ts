declare module "semantic-route-assistant-core" {
  export function buildIndex(projectRoot: string, outDir: string): Promise<void>;
  export function buildIndexV2(projectRoot: string, outDir: string): Promise<void>;
  export function updateIndex(projectRoot: string, outDir: string): Promise<void>;
  export function updateIndexV2(projectRoot: string, outDir: string): Promise<void>;
  export function searchSkills(
    indexRoot: string,
    query: string
  ): Promise<Array<{ path: string; score: number; title: string; preview: string }>>;
}
