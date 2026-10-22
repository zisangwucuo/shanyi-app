export const clothingCategories = ['上装', '下装', '连衣裙', '外套', '鞋履', '包袋', '配饰'];

export function filterMissingCategories(missing: string[], recognized: { category: string }[]) {
  const visible = new Set(recognized.map(item => item.category));
  return [...new Set(missing)].filter(category => clothingCategories.includes(category) && !visible.has(category));
}
