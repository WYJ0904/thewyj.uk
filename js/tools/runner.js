export function runToolRenderer(tool, renderers) {
  const renderer = renderers[tool?.category] || renderers.temporary;
  if (typeof renderer !== "function") throw new Error(`工具分类没有渲染器：${tool?.category || "unknown"}`);
  return renderer(tool);
}
