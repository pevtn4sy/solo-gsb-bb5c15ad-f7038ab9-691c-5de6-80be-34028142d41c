'use strict';

const { rgb } = require('pdf-lib');

/**
 * 印张定位标记（sheet registration marks）。
 *
 * 勾选该选项后，输出印张在版心（两个统一面板拼成的展开面）四周各增加一圈
 * 固定宽度的空白，并只在这片空白区内绘制印刷定位标记：
 *   - 正、背两面四角的**裁切线**：每角两条短线，分别沿版心的水平 / 垂直
 *     裁边向外延伸，与版心边保留一小段间隙（避免墨迹压到成品）；
 *   - 中央折线（左右半区分界线，即对折装订线）**上、下端的定位线**：
 *     沿折痕方向伸入空白区的短线。
 * 所有线段严格位于版心之外，不缩放、不移动任何源页内容。
 *
 * 源页仍按原尺寸与原页序居中放入各自半区，只是半区整体向纸面中央平移
 * 一个空白宽度；整册与分册签帖模式输出的每一张纸（正面 + 背面）都绘制。
 */

/** 1 mm 对应的 pt 数（1 inch = 25.4 mm = 72 pt） */
const PT_PER_MM = 72 / 25.4;
/** 勾选后版心四周增加的空白宽度（mm） */
const SHEET_MARK_MARGIN_MM = 8;
/** 裁切线与版心边缘之间的间隙（mm），保证标记不侵入成品 */
const SHEET_MARK_GAP_MM = 1.5;
/** 四角裁切线单段长度（mm） */
const SHEET_MARK_LENGTH_MM = 4;
/** 中央折线定位线长度（mm） */
const FOLD_MARK_LENGTH_MM = 5;
/** 标记线宽（pt） */
const MARK_LINE_WIDTH_PT = 0.5;

function mmToPt(mm) {
  return mm * PT_PER_MM;
}

/**
 * 定位标记的几何配置（pt）。各长度固定，仅空白宽度可通过参数覆盖
 * （当前版本固定为 SHEET_MARK_MARGIN_MM，预留参数化能力）。
 *
 * @param {number} [marginMm]
 * @returns {{ marginMm:number, marginPt:number, gapPt:number,
 *            lengthPt:number, foldLengthPt:number, lineWidthPt:number }}
 */
function sheetMarkConfig(marginMm = SHEET_MARK_MARGIN_MM) {
  const margin = mmToPt(marginMm);
  return {
    marginMm,
    marginPt: margin,
    gapPt: mmToPt(SHEET_MARK_GAP_MM),
    lengthPt: mmToPt(SHEET_MARK_LENGTH_MM),
    foldLengthPt: mmToPt(FOLD_MARK_LENGTH_MM),
    lineWidthPt: MARK_LINE_WIDTH_PT,
  };
}

/**
 * 启用定位标记后单张输出印张的实际尺寸：
 * 宽 = 2 × 面板宽 + 左右各一圈空白；高 = 面板高 + 上下各一圈空白。
 *
 * @param {{ width:number, height:number }} panel 统一面板尺寸（pt）
 * @param {object} cfg sheetMarkConfig 返回的配置
 * @returns {{ width:number, height:number }}
 */
function outputSheetSize(panel, cfg) {
  return {
    width: panel.width * 2 + cfg.marginPt * 2,
    height: panel.height + cfg.marginPt * 2,
  };
}

/**
 * 计算一页输出印张上全部定位标记线段（四角各 2 段 + 折线上下端各 1 段，
 * 共 10 段）。坐标原点为 PDF 左下角，单位 pt。
 *
 * 每段都从版心边缘外 gapPt 处起笔、向外延伸，保证严格位于版心之外。
 *
 * @param {number} sheetWidth 实际输出印张宽（pt）
 * @param {number} sheetHeight 实际输出印张高（pt）
 * @param {object} cfg sheetMarkConfig 返回的配置
 * @returns {Array<{ x1:number, y1:number, x2:number, y2:number, kind:string }>}
 */
function markSegments(sheetWidth, sheetHeight, cfg) {
  const m = cfg.marginPt;
  const g = cfg.gapPt;
  const len = cfg.lengthPt;
  const foldLen = cfg.foldLengthPt;

  // 版心（trim）四边
  const left = m;
  const right = sheetWidth - m;
  const bottom = m;
  const top = sheetHeight - m;
  const centerX = sheetWidth / 2;

  const segs = [];
  const seg = (x1, y1, x2, y2, kind) => segs.push({ x1, y1, x2, y2, kind });

  // —— 四角裁切线：每角一条沿垂直裁边的竖线、一条沿水平裁边的横线 ——
  // 左上角
  seg(left, top + g, left, top + g + len, 'crop-v');
  seg(left - g - len, top, left - g, top, 'crop-h');
  // 右上角
  seg(right, top + g, right, top + g + len, 'crop-v');
  seg(right + g, top, right + g + len, top, 'crop-h');
  // 左下角
  seg(left, bottom - g - len, left, bottom - g, 'crop-v');
  seg(left - g - len, bottom, left - g, bottom, 'crop-h');
  // 右下角
  seg(right, bottom - g - len, right, bottom - g, 'crop-v');
  seg(right + g, bottom, right + g + len, bottom, 'crop-h');

  // —— 中央折线上下端定位线（沿折痕伸入空白区）——
  seg(centerX, top + g, centerX, top + g + foldLen, 'fold-v');
  seg(centerX, bottom - g - foldLen, centerX, bottom - g, 'fold-v');

  return segs;
}

/**
 * 在一个输出印张页（正面或背面）上绘制定位标记。
 *
 * @param {PDFPage} page pdf-lib 页面对象（页面尺寸即实际输出印张尺寸）
 * @param {object} cfg sheetMarkConfig 返回的配置
 */
function drawSheetMarks(page, cfg) {
  const segments = markSegments(page.getWidth(), page.getHeight(), cfg);
  for (const s of segments) {
    page.drawLine({
      start: { x: s.x1, y: s.y1 },
      end: { x: s.x2, y: s.y2 },
      thickness: cfg.lineWidthPt,
      color: rgb(0, 0, 0),
      opacity: 1,
    });
  }
}

module.exports = {
  PT_PER_MM,
  SHEET_MARK_MARGIN_MM,
  SHEET_MARK_GAP_MM,
  SHEET_MARK_LENGTH_MM,
  FOLD_MARK_LENGTH_MM,
  MARK_LINE_WIDTH_PT,
  mmToPt,
  sheetMarkConfig,
  outputSheetSize,
  markSegments,
  drawSheetMarks,
};
