export type NavCategory = {
  label: string;
  href: string;
  matches: string[];
};

export const navCategories: NavCategory[] = [
  {
    label: 'Images & Documents',
    href: '/#images',
    matches: ['/tools/image', '/tools/ico', '/tools/pdf', '/tools/file', '/tools/metadata'],
  },
  {
    label: 'Typography & Color',
    href: '/#typography',
    matches: ['/tools/font', '/tools/wcag', '/tools/color', '/tools/tints'],
  },
  {
    label: 'Code & Web',
    href: '/#code',
    matches: ['/tools/code', '/tools/scss', '/tools/semantic', '/tools/brand', '/tools/xd', '/tools/token', '/tools/svg'],
  },
  {
    label: 'Text & Data',
    href: '/#text',
    matches: [
      '/tools/json', '/tools/base64', '/tools/jwt', '/tools/hash',
      '/tools/uuid', '/tools/regex', '/tools/cron', '/tools/timestamp',
    ],
  },
];
