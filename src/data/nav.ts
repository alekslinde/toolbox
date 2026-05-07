export type NavCategory = {
  label: string;
  href: string;
  matches: string[];
};

export const navCategories: NavCategory[] = [
  {
    label: 'Images & Documents',
    href: '/#images',
    matches: ['/tools/image', '/tools/ico', '/tools/pdf', '/tools/file'],
  },
  {
    label: 'Typography & Color',
    href: '/#typography',
    matches: ['/tools/font', '/tools/wcag', '/tools/color', '/tools/tints'],
  },
  {
    label: 'Code & Web',
    href: '/#code',
    matches: ['/tools/code', '/tools/scss', '/tools/semantic', '/tools/brand', '/tools/xd', '/tools/token'],
  },
];
