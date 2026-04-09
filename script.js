const blueprintInput = document.getElementById("blueprint");
const fileMeta = document.getElementById("fileMeta");
const scaleControl = document.getElementById("scale");
const scaleValue = document.getElementById("scaleValue");
const previewCanvas = document.getElementById("preview");
const downloadButton = document.getElementById("download");
const dimensionsLabel = document.getElementById("dimensions");
const pixelCountLabel = document.getElementById("pixelCount");
const paletteSizeLabel = document.getElementById("paletteSize");
const paletteLegend = document.getElementById("paletteLegend");
const autoCropButton = document.getElementById("autoCrop");
const statusText = document.getElementById("statusText");
const pageBadge = document.getElementById("pageBadge");
const prevPageButton = document.getElementById("prevPage");
const nextPageButton = document.getElementById("nextPage");
const openGuideButton = document.getElementById("openGuide");
const guideModal = document.getElementById("guideModal");
const closeGuideButton = document.getElementById("closeGuide");
const closeGuideBackdrop = document.getElementById("closeGuideBackdrop");
const cropInputs = {
  x: document.getElementById("cropX"),
  y: document.getElementById("cropY"),
  w: document.getElementById("cropW"),
  h: document.getElementById("cropH"),
};
const cropLabels = {
  x: document.getElementById("cropXLabel"),
  y: document.getElementById("cropYLabel"),
  w: document.getElementById("cropWLabel"),
  h: document.getElementById("cropHLabel"),
};

const previewCtx = previewCanvas.getContext("2d");
const offscreen = document.createElement("canvas");
const offCtx = offscreen.getContext("2d", { willReadFrequently: true });

const quantizationStep = 25;
const CELL_SIZE = 24;
const HEADER_SIZE = 30;
const MAJOR_GRID_EVERY = 10;
const LEGEND_GAP = 10;
const LEGEND_ITEM_HEIGHT = 34;
const LEGEND_ITEM_MIN_WIDTH = 92;
const PAGE_MAX_COLUMNS = 49;
const PAGE_MAX_ROWS = 49;
const COLOR_CODE_PRIORITY = ["H2", "B8", "H7", "F8", "G12", "F2", "E8", "E15"];

let currentImage = null;
let lastRendered = null;
let currentPageIndex = 0;
let baseRenderStats = null;

const updateCropLabels = () => {
  cropLabels.x.textContent = `${Math.round(parseFloat(cropInputs.x.value) * 100)}%`;
  cropLabels.y.textContent = `${Math.round(parseFloat(cropInputs.y.value) * 100)}%`;
  cropLabels.w.textContent = `${Math.round(parseFloat(cropInputs.w.value) * 100)}%`;
  cropLabels.h.textContent = `${Math.round(parseFloat(cropInputs.h.value) * 100)}%`;
};

const setStatus = (message) => {
  statusText.textContent = message;
};

const openGuide = () => {
  guideModal.setAttribute("aria-hidden", "false");
};

const closeGuide = () => {
  guideModal.setAttribute("aria-hidden", "true");
};

const getTargetBeadRatio = () => parseFloat(scaleControl.value);
const isBlankColor = (r, g, b) => r >= 245 && g >= 245 && b >= 245;
const getCropSignature = () => `${cropInputs.x.value}|${cropInputs.y.value}|${cropInputs.w.value}|${cropInputs.h.value}`;

const clampCrop = (value, size) => Math.max(0, Math.min(1, value / size));

const calculateCropRegion = (img) => {
  const cropX = parseFloat(cropInputs.x.value);
  const cropY = parseFloat(cropInputs.y.value);
  const cropW = parseFloat(cropInputs.w.value);
  const cropH = parseFloat(cropInputs.h.value);
  const sx = Math.round(img.width * cropX);
  const sy = Math.round(img.height * cropY);
  const sw = Math.max(1, Math.round(img.width * cropW));
  const sh = Math.max(1, Math.round(img.height * cropH));
  return {
    sx: Math.min(sx, img.width - 1),
    sy: Math.min(sy, img.height - 1),
    sw: Math.min(sw, img.width - sx),
    sh: Math.min(sh, img.height - sy),
  };
};

const calculateAutoCrop = (img) => {
  const tempCanvas = document.createElement("canvas");
  const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });
  tempCanvas.width = img.width;
  tempCanvas.height = img.height;
  tempCtx.drawImage(img, 0, 0);
  const { data } = tempCtx.getImageData(0, 0, img.width, img.height);
  const alphaThreshold = 10;
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const idx = (y * img.width + x) * 4;
      if (data[idx + 3] < alphaThreshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < 0 || maxY < 0) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }

  const margin = 0.03;
  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;

  return {
    x: Math.max(0, clampCrop(minX, img.width) - margin / 2),
    y: Math.max(0, clampCrop(minY, img.height) - margin / 2),
    w: Math.min(1, clampCrop(cropWidth, img.width) + margin),
    h: Math.min(1, clampCrop(cropHeight, img.height) + margin),
  };
};

const scaleAndDraw = (img, scale) => {
  const { sx, sy, sw, sh } = calculateCropRegion(img);
  offscreen.width = Math.max(1, Math.round(sw * scale));
  offscreen.height = Math.max(1, Math.round(sh * scale));
  offCtx.imageSmoothingEnabled = true;
  offCtx.clearRect(0, 0, offscreen.width, offscreen.height);
  offCtx.drawImage(img, sx, sy, sw, sh, 0, 0, offscreen.width, offscreen.height);
  return offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
};

const getBaseScale = (img) => {
  const { sw, sh } = calculateCropRegion(img);
  return Math.min(PAGE_MAX_COLUMNS / sw, PAGE_MAX_ROWS / sh, 1);
};

const getEffectiveScale = (img, requestedBeadRatio) => {
  const baseScale = getBaseScale(img);
  const requestedDimensionScale = Math.sqrt(Math.max(0.01, requestedBeadRatio));
  return Math.max(0.01, baseScale * requestedDimensionScale);
};

const getBeadCount = (palette) => palette.reduce((sum, entry) => sum + entry.count, 0);

const ensureBaseRenderStats = () => {
  if (!currentImage) return null;

  const cropSignature = getCropSignature();
  if (baseRenderStats?.image === currentImage && baseRenderStats.cropSignature === cropSignature) {
    return baseRenderStats;
  }

  const baseScale = getBaseScale(currentImage);
  const bitmap = scaleAndDraw(currentImage, baseScale);
  const { bitmap: quantized, palette } = quantize(bitmap);

  baseRenderStats = {
    image: currentImage,
    cropSignature,
    scale: baseScale,
    beadCount: getBeadCount(palette),
    width: quantized.width,
    height: quantized.height,
  };

  return baseRenderStats;
};

const updateScaleDisplay = () => {
  const beadRatio = getTargetBeadRatio();
  if (!currentImage) {
    scaleValue.textContent = `${Math.round(beadRatio * 100)}% 基准`;
    return;
  }

  const baseStats = ensureBaseRenderStats();
  const targetPixels = Math.max(1, Math.round(baseStats.beadCount * beadRatio));
  scaleValue.textContent = `${targetPixels} 颗`;
};

const quantize = (bitmap) => {
  const { data } = bitmap;
  const paletteMap = new Map();

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 16 || isBlankColor(data[i], data[i + 1], data[i + 2])) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
      continue;
    }

    const q = [
      Math.round(data[i] / quantizationStep) * quantizationStep,
      Math.round(data[i + 1] / quantizationStep) * quantizationStep,
      Math.round(data[i + 2] / quantizationStep) * quantizationStep,
    ].map((value) => Math.max(0, Math.min(255, value)));

    const key = q.join(",");
    data[i] = q[0];
    data[i + 1] = q[1];
    data[i + 2] = q[2];

    if (isBlankColor(q[0], q[1], q[2])) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      continue;
    }

    paletteMap.set(key, (paletteMap.get(key) || 0) + 1);
  }

  const palette = Array.from(paletteMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 256)
    .map(([key, count], index) => ({
      id: index + 1,
      code: buildColorCode(index),
      color: key,
      count,
    }));

  const paletteLookup = new Map(palette.map((item) => [item.color, item]));
  return { bitmap, palette, paletteLookup };
};

const buildColorCode = (index) => {
  const prefixPool = ["H", "B", "F", "G", "E"];
  const suffixPool = [2, 8, 7, 12, 15, 3, 5, 10, 18, 20, 6, 9, 11, 14, 16, 21];
  const prefix = prefixPool[index % prefixPool.length];
  const suffix = suffixPool[Math.floor(index / prefixPool.length) % suffixPool.length];
  return `${prefix}${suffix}`;
};

const getTextColor = (r, g, b) => {
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness < 145 ? "#ffffff" : "#22252b";
};

const drawHeaders = (columns, rows, startCol = 0, startRow = 0) => {
  previewCtx.fillStyle = "#d7dce2";
  previewCtx.fillRect(HEADER_SIZE, 0, columns * CELL_SIZE, HEADER_SIZE);
  previewCtx.fillRect(0, HEADER_SIZE, HEADER_SIZE, rows * CELL_SIZE);
  previewCtx.fillStyle = "#cfd5dc";
  previewCtx.fillRect(0, 0, HEADER_SIZE, HEADER_SIZE);

  previewCtx.fillStyle = "#505864";
  previewCtx.font = "12px 'PingFang SC', 'Noto Sans SC', sans-serif";
  previewCtx.textAlign = "center";
  previewCtx.textBaseline = "middle";

  for (let col = 0; col < columns; col += 1) {
    previewCtx.fillText(String(startCol + col + 1), HEADER_SIZE + col * CELL_SIZE + CELL_SIZE / 2, HEADER_SIZE / 2);
  }

  for (let row = 0; row < rows; row += 1) {
    previewCtx.fillText(String(startRow + row + 1), HEADER_SIZE / 2, HEADER_SIZE + row * CELL_SIZE + CELL_SIZE / 2);
  }
};

const drawWatermark = (columns, rows) => {
  previewCtx.save();
  previewCtx.fillStyle = "rgba(210, 180, 70, 0.18)";
  previewCtx.font = "28px 'PingFang SC', 'Noto Sans SC', sans-serif";
  previewCtx.textAlign = "center";
  previewCtx.textBaseline = "middle";

  const stepX = Math.max(180, CELL_SIZE * 8);
  const stepY = Math.max(160, CELL_SIZE * 8);

  for (let y = HEADER_SIZE + stepY / 2; y < HEADER_SIZE + rows * CELL_SIZE; y += stepY) {
    for (let x = HEADER_SIZE + stepX / 2; x < HEADER_SIZE + columns * CELL_SIZE; x += stepX) {
      previewCtx.fillText("拼豆图纸", x, y);
    }
  }

  previewCtx.restore();
};

const computeLegendLayout = (palette, columns) => {
  const maxLegendItemsPerRow = Math.max(1, Math.floor((HEADER_SIZE + columns * CELL_SIZE - 16) / (LEGEND_ITEM_MIN_WIDTH + LEGEND_GAP)));
  const itemsPerRow = Math.min(maxLegendItemsPerRow, Math.max(1, palette.length));
  const rows = Math.max(1, Math.ceil(Math.max(1, palette.length) / itemsPerRow));
  const legendHeight = 18 + rows * LEGEND_ITEM_HEIGHT + Math.max(0, rows - 1) * 8 + 16;
  return { itemsPerRow, rows, legendHeight };
};

const sortPaletteForLegend = (palette) => {
  return [...palette].sort((a, b) => {
    const priorityA = COLOR_CODE_PRIORITY.indexOf(a.code);
    const priorityB = COLOR_CODE_PRIORITY.indexOf(b.code);

    if (priorityA !== -1 || priorityB !== -1) {
      if (priorityA === -1) return 1;
      if (priorityB === -1) return -1;
      return priorityA - priorityB;
    }

    if (b.count !== a.count) {
      return b.count - a.count;
    }

    return a.code.localeCompare(b.code, "zh-CN");
  });
};

const drawLegendOnCanvas = (palette, totalWidth, contentBottom, itemsPerRow) => {
  const legendTop = contentBottom + 14;
  const usableWidth = totalWidth - 16;
  const itemWidth = Math.max(
    LEGEND_ITEM_MIN_WIDTH,
    Math.floor((usableWidth - (itemsPerRow - 1) * LEGEND_GAP) / itemsPerRow),
  );

  previewCtx.fillStyle = "#f3f5f7";
  previewCtx.fillRect(0, contentBottom, totalWidth, previewCanvas.height - contentBottom);

  palette.forEach((entry, index) => {
    const row = Math.floor(index / itemsPerRow);
    const col = index % itemsPerRow;
    const x = 8 + col * (itemWidth + LEGEND_GAP);
    const y = legendTop + row * (LEGEND_ITEM_HEIGHT + 8);

    previewCtx.fillStyle = "#ffffff";
    roundRect(x, y, itemWidth, LEGEND_ITEM_HEIGHT, 6);
    previewCtx.fill();
    previewCtx.strokeStyle = "#aeb6bf";
    previewCtx.lineWidth = 1;
    previewCtx.stroke();

    previewCtx.fillStyle = `rgb(${entry.color})`;
    roundRect(x + 4, y + 5, 32, LEGEND_ITEM_HEIGHT - 10, 4);
    previewCtx.fill();

    previewCtx.fillStyle = getTextColorFromString(entry.color);
    previewCtx.font = "700 10px 'PingFang SC', 'Noto Sans SC', sans-serif";
    previewCtx.textAlign = "center";
    previewCtx.textBaseline = "middle";
    previewCtx.fillText(entry.code, x + 20, y + LEGEND_ITEM_HEIGHT / 2);

    previewCtx.fillStyle = "#22252b";
    previewCtx.font = "700 12px 'PingFang SC', 'Noto Sans SC', sans-serif";
    previewCtx.textAlign = "left";
    previewCtx.fillText(String(entry.count), x + 44, y + LEGEND_ITEM_HEIGHT / 2);
  });
};

const roundRect = (x, y, width, height, radius) => {
  previewCtx.beginPath();
  previewCtx.moveTo(x + radius, y);
  previewCtx.arcTo(x + width, y, x + width, y + height, radius);
  previewCtx.arcTo(x + width, y + height, x, y + height, radius);
  previewCtx.arcTo(x, y + height, x, y, radius);
  previewCtx.arcTo(x, y, x + width, y, radius);
  previewCtx.closePath();
};

const getTextColorFromString = (colorString) => {
  const [r, g, b] = colorString.split(",").map(Number);
  return getTextColor(r, g, b);
};

const getPageSlices = (bitmap) => {
  const pageColumns = Math.ceil(bitmap.width / PAGE_MAX_COLUMNS);
  const pageRows = Math.ceil(bitmap.height / PAGE_MAX_ROWS);
  const pages = [];

  for (let pageRow = 0; pageRow < pageRows; pageRow += 1) {
    for (let pageCol = 0; pageCol < pageColumns; pageCol += 1) {
      const startCol = pageCol * PAGE_MAX_COLUMNS;
      const startRow = pageRow * PAGE_MAX_ROWS;
      pages.push({
        startCol,
        startRow,
        columns: Math.min(PAGE_MAX_COLUMNS, bitmap.width - startCol),
        rows: Math.min(PAGE_MAX_ROWS, bitmap.height - startRow),
      });
    }
  }

  return pages;
};

const updatePageControls = (pageIndex, totalPages) => {
  pageBadge.textContent = `${pageIndex + 1}/${totalPages}`;
  prevPageButton.disabled = pageIndex <= 0;
  nextPageButton.disabled = pageIndex >= totalPages - 1;
};

const drawGrid = (bitmap, paletteLookup, pageIndex = 0) => {
  const pages = getPageSlices(bitmap);
  const page = pages[Math.max(0, Math.min(pageIndex, pages.length - 1))];
  const palette = sortPaletteForLegend(Array.from(paletteLookup.values()));
  const { itemsPerRow, legendHeight } = computeLegendLayout(palette, page.columns);
  const totalWidth = HEADER_SIZE + page.columns * CELL_SIZE;
  const gridBottom = HEADER_SIZE + page.rows * CELL_SIZE;
  const totalHeight = gridBottom + legendHeight;

  previewCanvas.width = totalWidth;
  previewCanvas.height = totalHeight;

  previewCtx.clearRect(0, 0, totalWidth, totalHeight);
  previewCtx.fillStyle = "#f0f2f5";
  previewCtx.fillRect(0, 0, totalWidth, totalHeight);
  previewCtx.fillStyle = "#ffffff";
  previewCtx.fillRect(HEADER_SIZE, HEADER_SIZE, page.columns * CELL_SIZE, page.rows * CELL_SIZE);

  drawHeaders(page.columns, page.rows, page.startCol, page.startRow);
  drawWatermark(page.columns, page.rows);

  const imageData = bitmap.data;
  const bitmapColumns = bitmap.width;

  for (let row = 0; row < page.rows; row += 1) {
    for (let col = 0; col < page.columns; col += 1) {
      const sourceCol = page.startCol + col;
      const sourceRow = page.startRow + row;
      const idx = (sourceRow * bitmapColumns + sourceCol) * 4;
      const r = imageData[idx];
      const g = imageData[idx + 1];
      const b = imageData[idx + 2];
      const colorKey = `${r},${g},${b}`;
      const paletteItem = paletteLookup.get(colorKey);
      const x = HEADER_SIZE + col * CELL_SIZE;
      const y = HEADER_SIZE + row * CELL_SIZE;

      previewCtx.fillStyle = `rgb(${colorKey})`;
      previewCtx.fillRect(x, y, CELL_SIZE, CELL_SIZE);

      previewCtx.strokeStyle = "#cfd5dc";
      previewCtx.lineWidth = 1;
      previewCtx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);

      if (paletteItem) {
        previewCtx.fillStyle = getTextColor(r, g, b);
        previewCtx.font = "10px 'PingFang SC', 'Noto Sans SC', sans-serif";
        previewCtx.textAlign = "center";
        previewCtx.textBaseline = "middle";
        previewCtx.fillText(paletteItem.code, x + CELL_SIZE / 2, y + CELL_SIZE / 2);
      }
    }
  }

  previewCtx.strokeStyle = "#ef5b4f";
  previewCtx.lineWidth = 2;

  for (let col = 0; col <= page.columns; col += MAJOR_GRID_EVERY) {
    const x = HEADER_SIZE + col * CELL_SIZE;
    previewCtx.beginPath();
    previewCtx.moveTo(x, 0);
    previewCtx.lineTo(x, HEADER_SIZE + page.rows * CELL_SIZE);
    previewCtx.stroke();
  }

  for (let row = 0; row <= page.rows; row += MAJOR_GRID_EVERY) {
    const y = HEADER_SIZE + row * CELL_SIZE;
    previewCtx.beginPath();
    previewCtx.moveTo(0, y);
    previewCtx.lineTo(HEADER_SIZE + page.columns * CELL_SIZE, y);
    previewCtx.stroke();
  }

  drawLegendOnCanvas(palette, totalWidth, gridBottom, itemsPerRow);
  updatePageControls(pageIndex, pages.length);
};

const updatePaletteLegend = (palette) => {
  const sortedPalette = sortPaletteForLegend(palette);
  paletteLegend.innerHTML = "";
  paletteLegend.classList.remove("empty");

  if (!sortedPalette.length) {
    paletteLegend.classList.add("empty");
    paletteLegend.textContent = "暂无色号统计";
    return;
  }

  sortedPalette.forEach((entry) => {
    const chip = document.createElement("div");
    chip.className = "legend-chip";
    chip.innerHTML = `
      <span class="legend-swatch" style="background: rgb(${entry.color})"></span>
      <span class="legend-code">${entry.code}</span>
      <span class="legend-count">${entry.count}</span>
    `;
    paletteLegend.appendChild(chip);
  });
};

const refreshData = (bitmap, palette) => {
  dimensionsLabel.textContent = `${bitmap.width} × ${bitmap.height}`;
  pixelCountLabel.textContent = String(getBeadCount(palette));
  paletteSizeLabel.textContent = String(palette.length);
  updatePaletteLegend(palette);
  downloadButton.disabled = false;
  setStatus("图纸已生成");
};

const processImage = () => {
  if (!currentImage) return;

  setStatus("正在生成图纸");
  const baseStats = ensureBaseRenderStats();
  const requestedBeadRatio = getTargetBeadRatio();
  const requestedPixels = Math.max(1, Math.round(baseStats.beadCount * requestedBeadRatio));
  const effectiveScale = getEffectiveScale(currentImage, requestedBeadRatio);
  const bitmap = scaleAndDraw(currentImage, effectiveScale);
  const { bitmap: quantized, palette, paletteLookup } = quantize(bitmap);
  const actualPixels = getBeadCount(palette);

  currentPageIndex = 0;
  drawGrid(quantized, paletteLookup, currentPageIndex);
  refreshData(quantized, palette);
  lastRendered = { bitmap: quantized, palette, paletteLookup };

  if (actualPixels !== requestedPixels) {
    setStatus(`图纸已生成，基准 ${baseStats.beadCount} 颗，目标 ${requestedPixels} 颗，实际 ${actualPixels} 颗`);
  }
};

const autoCrop = () => {
  if (!currentImage) return;
  const cropRegion = calculateAutoCrop(currentImage);
  cropInputs.x.value = cropRegion.x.toFixed(2);
  cropInputs.y.value = cropRegion.y.toFixed(2);
  cropInputs.w.value = cropRegion.w.toFixed(2);
  cropInputs.h.value = cropRegion.h.toFixed(2);
  updateCropLabels();
  processImage();
};

const handleInteraction = () => {
  updateCropLabels();
  updateScaleDisplay();
  processImage();
};

const resetCanvas = () => {
  previewCanvas.width = 800;
  previewCanvas.height = 520;
  pageBadge.textContent = "1/1";
  prevPageButton.disabled = true;
  nextPageButton.disabled = true;
  previewCtx.fillStyle = "#f0f2f5";
  previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
  previewCtx.fillStyle = "#6a727d";
  previewCtx.font = "18px 'PingFang SC', 'Noto Sans SC', sans-serif";
  previewCtx.textAlign = "center";
  previewCtx.textBaseline = "middle";
  previewCtx.fillText("上传图片后生成拼豆图纸", previewCanvas.width / 2, previewCanvas.height / 2);
};

const handleFile = (file) => {
  const reader = new FileReader();

  reader.onerror = () => {
    setStatus("读取图片失败");
  };

  reader.onload = () => {
    const img = new Image();

    img.onload = () => {
      currentImage = img;
      baseRenderStats = null;
      fileMeta.textContent = `${file.name} · ${img.width} × ${img.height}`;
      updateScaleDisplay();
      setStatus("图片已载入");
      handleInteraction();
    };

    img.onerror = () => {
      setStatus("图片格式无法解析");
    };

    img.src = reader.result;
  };

  reader.readAsDataURL(file);
};

scaleControl.addEventListener("input", () => {
  updateScaleDisplay();
  handleInteraction();
});

Object.values(cropInputs).forEach((input) => {
  input.addEventListener("input", handleInteraction);
});

autoCropButton.addEventListener("click", autoCrop);

blueprintInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  handleFile(file);
});

downloadButton.addEventListener("click", () => {
  if (!lastRendered) return;

  previewCanvas.toBlob((blob) => {
    if (!blob) {
      setStatus("导出失败");
      return;
    }
    const link = document.createElement("a");
    link.download = `拼豆图纸-p${currentPageIndex + 1}.png`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
    setStatus("图纸已下载");
  });
});

prevPageButton.addEventListener("click", () => {
  if (!lastRendered || currentPageIndex <= 0) return;
  currentPageIndex -= 1;
  drawGrid(lastRendered.bitmap, lastRendered.paletteLookup, currentPageIndex);
  setStatus(`查看第 ${currentPageIndex + 1} 页`);
});

nextPageButton.addEventListener("click", () => {
  if (!lastRendered) return;
  const totalPages = getPageSlices(lastRendered.bitmap).length;
  if (currentPageIndex >= totalPages - 1) return;
  currentPageIndex += 1;
  drawGrid(lastRendered.bitmap, lastRendered.paletteLookup, currentPageIndex);
  setStatus(`查看第 ${currentPageIndex + 1} 页`);
});

openGuideButton.addEventListener("click", openGuide);
closeGuideButton.addEventListener("click", closeGuide);
closeGuideBackdrop.addEventListener("click", closeGuide);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeGuide();
  }
});

updateCropLabels();
updateScaleDisplay();
resetCanvas();
