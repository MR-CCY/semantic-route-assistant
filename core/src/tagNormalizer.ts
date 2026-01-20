/**
 * Tag Normalizer - Local cleaning logic for tags
 * 
 * This module provides deterministic, regex-based tag normalization
 * that runs locally without LLM calls. It handles:
 * - Stop word filtering (exact match)
 * - Alias mapping (canonical forms)
 * - Format normalization (snake_case)
 */

/**
 * Stop words to filter out (exact match only)
 * These are programming keywords or overly generic terms
 */
export const STOP_WORDS = new Set([
    // Programming keywords
    "return",
    "void",
    "null",
    "undefined",
    "class",
    "struct",
    "interface",
    "impl",
    "function",
    "method",
    "default",
    "true",
    "false",
    "const",
    "let",
    "var",
    "static",
    "public",
    "private",
    "protected",
    "abstract",
    "virtual",
    "override",
    "final",
    "new",
    "delete",
    "this",
    "self",
    "super",
    "extends",
    "implements",
    // Overly generic terms
    "get",
    "set",
    "do",
    "run",
    "make",
    "create",
    "build",
    "handle",
    "process",
    "execute",
    "call",
    "invoke",
    "apply",
    "use",
    "main",
    "start",
    "stop",
    "init",
    "exit",
    "end",
    "begin",
    "open",
    "close",
    "load",
    "save",
    "read",
    "write",
    "input",
    "output",
    "data",
    "value",
    "result",
    "item",
    "element",
    "node",
    "list",
    "array",
    "map",
    "object",
    "string",
    "number",
    "integer",
    "boolean",
    "type",
    "name",
    "id",
    "key",
    "index",
    "count",
    "size",
    "length",
    "info",
    "state",
    "status",
    "flag",
    "option",
    "options",
    "param",
    "params",
    "arg",
    "args",
    "temp",
    "tmp",
    "test",
    "debug",
    "log",
    "print",
    "foo",
    "bar",
    "baz",
    "example",
    "sample",
    "demo",
    "todo",
    "fixme",
    "hack",
    "note",
    "xxx",
    // Common paths/modules
    "src",
    "lib",
    "dist",
    "out",
    "bin",
    "build",
    "core",
    "common",
    "shared",
    "base",
    "utils",
    "util",
    "helper",
    "helpers",
    "internal",
    "impl",
    "detail",
    "details",
]);

/**
 * Hard-coded alias mappings for canonical forms
 * Maps abbreviations and variants to their canonical form
 */
export const HARD_ALIASES: Record<string, string> = {
    // Data types
    str: "string",
    int: "integer",
    num: "number",
    bool: "boolean",
    arr: "array",
    obj: "object",
    dict: "dictionary",
    vec: "vector",
    ptr: "pointer",
    ref: "reference",
    char: "character",

    // Common abbreviations
    db: "database",
    repo: "repository",
    config: "configuration",
    cfg: "configuration",
    conf: "configuration",
    env: "environment",
    var: "variable",
    vars: "variables",
    param: "parameter",
    params: "parameters",
    arg: "argument",
    args: "arguments",
    attr: "attribute",
    attrs: "attributes",
    prop: "property",
    props: "properties",

    // Actions
    err: "error",
    errs: "errors",
    warn: "warning",
    msg: "message",
    msgs: "messages",
    req: "request",
    reqs: "requests",
    res: "response",
    resp: "response",
    ctx: "context",
    fn: "function",
    func: "function",
    cb: "callback",
    evt: "event",
    evts: "events",
    cmd: "command",
    cmds: "commands",
    op: "operation",
    ops: "operations",

    // Networking
    http: "http",
    https: "https",
    ws: "websocket",
    wss: "websocket",
    tcp: "tcp",
    udp: "udp",
    api: "api",
    rest: "rest_api",
    rpc: "rpc",
    grpc: "grpc",
    url: "url",
    uri: "uri",
    dns: "dns",
    ip: "ip_address",

    // Authentication
    auth: "authentication",
    authn: "authentication",
    authz: "authorization",
    oauth: "oauth",
    jwt: "jwt",
    token: "token",
    cred: "credential",
    creds: "credentials",
    pwd: "password",
    passwd: "password",

    // Data formats
    json: "json",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    csv: "csv",
    html: "html",
    css: "css",
    js: "javascript",
    ts: "typescript",
    py: "python",
    rb: "ruby",
    cpp: "cpp",
    cxx: "cpp",

    // Database
    sql: "sql",
    nosql: "nosql",
    mongo: "mongodb",
    mysql: "mysql",
    postgres: "postgresql",
    pg: "postgresql",
    redis: "redis",
    sqlite: "sqlite",
    orm: "orm",

    // File system
    fs: "filesystem",
    file: "file",
    dir: "directory",
    dirs: "directories",
    path: "path",
    io: "io",

    // Concurrency
    async: "async",
    sync: "sync",
    await: "await",
    thread: "thread",
    threads: "threads",
    mutex: "mutex",
    lock: "lock",
    sem: "semaphore",
    chan: "channel",
    cond: "condition",

    // Memory
    mem: "memory",
    alloc: "allocation",
    dealloc: "deallocation",
    gc: "garbage_collection",
    heap: "heap",
    stack: "stack",
    buf: "buffer",
    cache: "cache",

    // Testing
    spec: "specification",
    specs: "specifications",
    mock: "mock",
    stub: "stub",
    fake: "fake",
    assert: "assertion",
    expect: "expectation",

    // Misc
    doc: "documentation",
    docs: "documentation",
    ver: "version",
    vers: "versions",
    max: "maximum",
    min: "minimum",
    avg: "average",
    len: "length",
    cnt: "count",
    idx: "index",
    pos: "position",
    src_file: "source",
    dst: "destination",
    dest: "destination",
    prev: "previous",
    curr: "current",
    next: "next",

    // Chinese common terms (normalize to English for consistency)
    配置: "configuration",
    请求: "request",
    响应: "response",
    错误: "error",
    缓存: "cache",
    数据库: "database",
    文件: "file",
    网络: "network",
    认证: "authentication",
    授权: "authorization",
};

/**
 * Normalize a single tag using local rules
 * 
 * @param tag - Raw tag string
 * @returns Normalized tag in snake_case, or null if it should be filtered
 */
export function localNormalize(tag: string): string | null {
    // Step 1: Basic cleanup
    let normalized = tag.trim().toLowerCase();

    if (!normalized || normalized.length < 2) {
        return null;
    }

    // Step 2: Replace spaces, hyphens, dots with underscores (snake_case)
    normalized = normalized
        .replace(/[\s\-\.]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");

    // Step 2.5: If tag contains CJK, remove underscores around CJK boundaries
    if (/[\u4e00-\u9fff]/.test(normalized)) {
        normalized = normalized
            .replace(/([\u4e00-\u9fff])_+([\u4e00-\u9fff])/g, "$1$2")
            .replace(/([a-z0-9])_+([\u4e00-\u9fff])/g, "$1$2")
            .replace(/([\u4e00-\u9fff])_+([a-z0-9])/g, "$1$2")
            .replace(/_+/g, "_")
            .replace(/^_|_$/g, "");
    }

    // Step 3: Remove non-alphanumeric characters except underscores
    normalized = normalized.replace(/[^a-z0-9_\u4e00-\u9fff]/g, "");

    if (!normalized || normalized.length < 2) {
        return null;
    }

    // Step 4: Check stop words (exact match)
    if (STOP_WORDS.has(normalized)) {
        return null;
    }

    // Step 5: Apply hard aliases
    if (HARD_ALIASES[normalized]) {
        normalized = HARD_ALIASES[normalized];
    }

    // Step 6: Final length check
    if (normalized.length < 2) {
        return null;
    }

    return normalized;
}

/**
 * Normalize a list of tags, removing duplicates
 * 
 * @param tags - Array of raw tag strings
 * @returns Deduplicated array of normalized tags
 */
export function normalizeTagList(tags: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const tag of tags) {
        const normalized = localNormalize(tag);
        if (normalized && !seen.has(normalized)) {
            seen.add(normalized);
            result.push(normalized);
        }
    }

    return result;
}

/**
 * Apply alias mapping to a tag using the provided alias map
 * Handles transitive aliases (a -> b -> c) with cycle detection
 * 
 * @param tag - Normalized tag
 * @param aliases - Alias mapping from tagMetadata
 * @returns Canonical tag after alias resolution
 */
export function applyAliasMapping(
    tag: string,
    aliases: Record<string, string>
): string {
    const visited = new Set<string>();
    let current = tag;

    // Resolve alias chain with cycle detection (max 10 hops)
    while (aliases[current] && !visited.has(current) && visited.size < 10) {
        visited.add(current);
        current = aliases[current];
    }

    return current;
}

/**
 * Normalize and apply aliases to a list of tags
 * 
 * @param tags - Array of raw tag strings
 * @param aliases - Alias mapping from tagMetadata
 * @returns Deduplicated array of canonical tags
 */
export function normalizeAndApplyAliases(
    tags: string[],
    aliases: Record<string, string>
): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const tag of tags) {
        const normalized = localNormalize(tag);
        if (!normalized) {
            continue;
        }

        const canonical = applyAliasMapping(normalized, aliases);
        if (!seen.has(canonical)) {
            seen.add(canonical);
            result.push(canonical);
        }
    }

    return result;
}

/**
 * Detect cycles in an alias map
 * 
 * @param aliases - Alias mapping to check
 * @returns Array of tags that are part of cycles
 */
export function detectAliasCycles(aliases: Record<string, string>): string[] {
    const cycles: string[] = [];

    for (const startTag of Object.keys(aliases)) {
        const visited = new Set<string>();
        let current = startTag;

        while (aliases[current] && !visited.has(current)) {
            visited.add(current);
            current = aliases[current];
        }

        if (visited.has(current)) {
            cycles.push(startTag);
        }
    }

    return cycles;
}

/**
 * Remove cycles from alias map by breaking the chain at the cycle point
 * 
 * @param aliases - Alias mapping to clean
 * @returns New alias map with cycles removed
 */
export function removeAliasCycles(
    aliases: Record<string, string>
): Record<string, string> {
    const cleanedAliases: Record<string, string> = {};

    for (const [tag, target] of Object.entries(aliases)) {
        const visited = new Set<string>();
        let current = tag;
        let isValid = true;

        // Check if this mapping leads to a cycle
        while (aliases[current] && !visited.has(current)) {
            visited.add(current);
            current = aliases[current];
        }

        if (visited.has(current)) {
            // This tag is part of a cycle, skip it
            isValid = false;
        }

        if (isValid) {
            cleanedAliases[tag] = target;
        }
    }

    return cleanedAliases;
}
