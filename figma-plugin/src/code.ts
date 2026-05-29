/// <reference types="@figma/plugin-typings" />

figma.showUI(__html__, { width: 380, height: 560, title: 'Brand Assets Extractor' });

/* ── Colour helper ── */
function hexToFigmaRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

/* ── Apply actions ── */
async function applyColorStyles(colors: Array<{ hex: string; name: string; role: string }>) {
  let count = 0;
  for (const color of colors) {
    try {
      const style = figma.createPaintStyle();
      style.name = `Brand/${color.name}`;
      style.paints = [{ type: 'SOLID', color: hexToFigmaRgb(color.hex), opacity: 1 }];
      count++;
    } catch { /* skip invalid hex */ }
  }
  return count;
}

async function applyIonicVariables(ionicColors: Array<{
  name: string; base: string; shade: string; tint: string;
  rgb: string; contrast: string; contrastRgb: string; fromBrand: boolean;
}>) {
  const collection = figma.variables.createVariableCollection('Ionic Palette');
  const modeId = collection.modes[0].modeId;
  collection.renameMode(modeId, 'Default');

  let count = 0;
  for (const ic of ionicColors) {
    try {
      const baseVar = figma.variables.createVariable(`${ic.name}/base`, collection.id, 'COLOR');
      baseVar.setValueForMode(modeId, hexToFigmaRgb(ic.base));
      count++;

      const shadeVar = figma.variables.createVariable(`${ic.name}/shade`, collection.id, 'COLOR');
      shadeVar.setValueForMode(modeId, hexToFigmaRgb(ic.shade));
      count++;

      const tintVar = figma.variables.createVariable(`${ic.name}/tint`, collection.id, 'COLOR');
      tintVar.setValueForMode(modeId, hexToFigmaRgb(ic.tint));
      count++;
    } catch { /* skip */ }
  }
  return count;
}

async function createStyleGuideFrame(data: {
  name: string;
  domain: string;
  colors: Array<{ hex: string; name: string; role: string }>;
  fonts: Array<{ name: string; role: string; source: string }>;
  ionicColors: Array<{ name: string; base: string; shade: string; tint: string; fromBrand: boolean }>;
}): Promise<FrameNode> {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });

  const frame = figma.createFrame();
  frame.name = `${data.name} — Brand Style Guide`;
  frame.layoutMode = 'VERTICAL';
  frame.itemSpacing = 32;
  frame.paddingLeft = 40;
  frame.paddingRight = 40;
  frame.paddingTop = 40;
  frame.paddingBottom = 40;
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'FIXED';
  frame.resize(900, frame.height);
  frame.fills = [{ type: 'SOLID', color: { r: 0.973, g: 0.973, b: 0.980 } }];
  frame.cornerRadius = 16;

  /* ── Header ── */
  const headerFrame = figma.createFrame();
  headerFrame.name = 'Header';
  headerFrame.layoutMode = 'VERTICAL';
  headerFrame.itemSpacing = 4;
  headerFrame.fills = [];
  headerFrame.primaryAxisSizingMode = 'AUTO';
  headerFrame.counterAxisSizingMode = 'AUTO';

  const titleText = figma.createText();
  titleText.fontName = { family: 'Inter', style: 'Bold' };
  titleText.characters = data.name || data.domain;
  titleText.fontSize = 28;
  titleText.fills = [{ type: 'SOLID', color: { r: 0.118, g: 0.161, b: 0.239 } }];

  const domainText = figma.createText();
  domainText.fontName = { family: 'Inter', style: 'Regular' };
  domainText.characters = data.domain;
  domainText.fontSize = 14;
  domainText.fills = [{ type: 'SOLID', color: { r: 0.580, g: 0.639, b: 0.722 } }];

  headerFrame.appendChild(titleText);
  headerFrame.appendChild(domainText);
  frame.appendChild(headerFrame);

  /* ── Brand Colors section ── */
  if (data.colors.length > 0) {
    const colorSection = figma.createFrame();
    colorSection.name = 'Brand Colors';
    colorSection.layoutMode = 'VERTICAL';
    colorSection.itemSpacing = 16;
    colorSection.fills = [];
    colorSection.primaryAxisSizingMode = 'AUTO';
    colorSection.counterAxisSizingMode = 'AUTO';

    const colorSectionLabel = figma.createText();
    colorSectionLabel.fontName = { family: 'Inter', style: 'Bold' };
    colorSectionLabel.characters = 'BRAND COLORS';
    colorSectionLabel.fontSize = 11;
    colorSectionLabel.letterSpacing = { value: 1, unit: 'PIXELS' };
    colorSectionLabel.fills = [{ type: 'SOLID', color: { r: 0.580, g: 0.639, b: 0.722 } }];
    colorSection.appendChild(colorSectionLabel);

    const colorRow = figma.createFrame();
    colorRow.name = 'Color Swatches';
    colorRow.layoutMode = 'HORIZONTAL';
    colorRow.itemSpacing = 12;
    colorRow.fills = [];
    colorRow.primaryAxisSizingMode = 'AUTO';
    colorRow.counterAxisSizingMode = 'AUTO';

    for (const color of data.colors) {
      try {
        const swatchGroup = figma.createFrame();
        swatchGroup.name = color.name;
        swatchGroup.layoutMode = 'VERTICAL';
        swatchGroup.itemSpacing = 6;
        swatchGroup.fills = [];
        swatchGroup.primaryAxisSizingMode = 'AUTO';
        swatchGroup.counterAxisSizingMode = 'AUTO';

        const rect = figma.createRectangle();
        rect.resize(60, 60);
        rect.fills = [{ type: 'SOLID', color: hexToFigmaRgb(color.hex) }];
        rect.cornerRadius = 8;
        swatchGroup.appendChild(rect);

        const hexLabel = figma.createText();
        hexLabel.fontName = { family: 'Inter', style: 'Medium' };
        hexLabel.characters = color.hex;
        hexLabel.fontSize = 10;
        hexLabel.fills = [{ type: 'SOLID', color: { r: 0.282, g: 0.337, b: 0.416 } }];
        swatchGroup.appendChild(hexLabel);

        const nameLabel = figma.createText();
        nameLabel.fontName = { family: 'Inter', style: 'Regular' };
        nameLabel.characters = color.name;
        nameLabel.fontSize = 9;
        nameLabel.fills = [{ type: 'SOLID', color: { r: 0.580, g: 0.639, b: 0.722 } }];
        swatchGroup.appendChild(nameLabel);

        colorRow.appendChild(swatchGroup);
      } catch { /* skip bad hex */ }
    }

    colorSection.appendChild(colorRow);
    frame.appendChild(colorSection);
  }

  /* ── Ionic Palette section ── */
  if (data.ionicColors.length > 0) {
    const ionicSection = figma.createFrame();
    ionicSection.name = 'Ionic Palette';
    ionicSection.layoutMode = 'VERTICAL';
    ionicSection.itemSpacing = 16;
    ionicSection.fills = [];
    ionicSection.primaryAxisSizingMode = 'AUTO';
    ionicSection.counterAxisSizingMode = 'AUTO';

    const ionicLabel = figma.createText();
    ionicLabel.fontName = { family: 'Inter', style: 'Bold' };
    ionicLabel.characters = 'IONIC PALETTE';
    ionicLabel.fontSize = 11;
    ionicLabel.letterSpacing = { value: 1, unit: 'PIXELS' };
    ionicLabel.fills = [{ type: 'SOLID', color: { r: 0.580, g: 0.639, b: 0.722 } }];
    ionicSection.appendChild(ionicLabel);

    const ionicRow = figma.createFrame();
    ionicRow.name = 'Ionic Color Swatches';
    ionicRow.layoutMode = 'HORIZONTAL';
    ionicRow.itemSpacing = 10;
    ionicRow.fills = [];
    ionicRow.primaryAxisSizingMode = 'AUTO';
    ionicRow.counterAxisSizingMode = 'AUTO';

    for (const ic of data.ionicColors) {
      try {
        const swatchGroup = figma.createFrame();
        swatchGroup.name = ic.name;
        swatchGroup.layoutMode = 'VERTICAL';
        swatchGroup.itemSpacing = 4;
        swatchGroup.fills = [];
        swatchGroup.primaryAxisSizingMode = 'AUTO';
        swatchGroup.counterAxisSizingMode = 'AUTO';

        const rect = figma.createRectangle();
        rect.resize(52, 52);
        rect.fills = [{ type: 'SOLID', color: hexToFigmaRgb(ic.base) }];
        rect.cornerRadius = 6;
        swatchGroup.appendChild(rect);

        const roleLabel = figma.createText();
        roleLabel.fontName = { family: 'Inter', style: 'Medium' };
        roleLabel.characters = ic.name;
        roleLabel.fontSize = 9;
        roleLabel.fills = [{ type: 'SOLID', color: { r: 0.282, g: 0.337, b: 0.416 } }];
        swatchGroup.appendChild(roleLabel);

        ionicRow.appendChild(swatchGroup);
      } catch { /* skip */ }
    }

    ionicSection.appendChild(ionicRow);
    frame.appendChild(ionicSection);
  }

  /* ── Typography section ── */
  if (data.fonts.length > 0) {
    const typographySection = figma.createFrame();
    typographySection.name = 'Typography';
    typographySection.layoutMode = 'VERTICAL';
    typographySection.itemSpacing = 10;
    typographySection.fills = [];
    typographySection.primaryAxisSizingMode = 'AUTO';
    typographySection.counterAxisSizingMode = 'AUTO';

    const typoLabel = figma.createText();
    typoLabel.fontName = { family: 'Inter', style: 'Bold' };
    typoLabel.characters = 'TYPOGRAPHY';
    typoLabel.fontSize = 11;
    typoLabel.letterSpacing = { value: 1, unit: 'PIXELS' };
    typoLabel.fills = [{ type: 'SOLID', color: { r: 0.580, g: 0.639, b: 0.722 } }];
    typographySection.appendChild(typoLabel);

    for (const font of data.fonts) {
      const fontRow = figma.createFrame();
      fontRow.name = font.name;
      fontRow.layoutMode = 'VERTICAL';
      fontRow.itemSpacing = 2;
      fontRow.fills = [];
      fontRow.primaryAxisSizingMode = 'AUTO';
      fontRow.counterAxisSizingMode = 'AUTO';

      const fontNameText = figma.createText();
      fontNameText.fontName = { family: 'Inter', style: 'Medium' };
      fontNameText.characters = font.name;
      fontNameText.fontSize = 13;
      fontNameText.fills = [{ type: 'SOLID', color: { r: 0.200, g: 0.255, b: 0.337 } }];
      fontRow.appendChild(fontNameText);

      const fontMetaText = figma.createText();
      fontMetaText.fontName = { family: 'Inter', style: 'Regular' };
      fontMetaText.characters = `${font.role} · ${font.source}`;
      fontMetaText.fontSize = 11;
      fontMetaText.fills = [{ type: 'SOLID', color: { r: 0.580, g: 0.639, b: 0.722 } }];
      fontRow.appendChild(fontMetaText);

      typographySection.appendChild(fontRow);
    }

    frame.appendChild(typographySection);
  }

  /* Position on canvas */
  frame.x = figma.viewport.center.x - 450;
  frame.y = figma.viewport.center.y - 200;

  figma.currentPage.appendChild(frame);
  return frame;
}

/* ── Message handler ── */
figma.ui.onmessage = async (msg: any) => {
  if (msg.type === 'close') {
    figma.closePlugin();
    return;
  }

  if (msg.type === 'apply') {
    const { data, options } = msg;
    let totalCount = 0;
    let createdFrame: FrameNode | null = null;

    try {
      /* Color Styles */
      if (options.styles && data.colors?.length) {
        const count = await applyColorStyles(data.colors);
        totalCount += count;
      }

      /* Ionic Variables */
      if (options.variables && data.ionicColors?.length) {
        const count = await applyIonicVariables(data.ionicColors);
        totalCount += count;
      }

      /* Style Guide Frame */
      if (options.frame) {
        createdFrame = await createStyleGuideFrame({
          name: data.name,
          domain: data.domain,
          colors: data.colors || [],
          fonts: data.fonts || [],
          ionicColors: data.ionicColors || [],
        });
        totalCount += 1;
      }

      if (createdFrame) {
        figma.viewport.scrollAndZoomIntoView([createdFrame]);
      }

      figma.ui.postMessage({ type: 'done', success: true, count: totalCount });
    } catch (err: any) {
      figma.ui.postMessage({ type: 'done', success: false, error: err.message || 'Unknown error', count: totalCount });
    }
  }
};
