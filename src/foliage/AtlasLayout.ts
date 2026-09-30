// Six 512px cells, five occupied. A 16px dilated gutter protects ordinary mips.
export const atlasLayout = { width: 1536, height: 1024, cell: 512, gutter: 16, columns: 3, variants: 5 } as const;
export function atlasUV(index: number, u: number, v: number): [number, number] {
  const { width, height, cell, gutter, columns } = atlasLayout;
  const inner = cell - gutter * 2;
  // Texel centers keep UV endpoints inside the duplicated border.
  return [(index % columns * cell + gutter + 0.5 + u * (inner - 1)) / width,
    (Math.floor(index / columns) * cell + gutter + 0.5 + v * (inner - 1)) / height];
}
