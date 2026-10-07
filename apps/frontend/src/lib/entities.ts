/** 实体页的地址（见 GLOSSARY.md「实体」）。key 是归一后的写法；放在查询串里而不是路径里：实体的写法可以带斜杠 */
export const entityHref = (key: string) => `/entities?name=${encodeURIComponent(key)}`;
