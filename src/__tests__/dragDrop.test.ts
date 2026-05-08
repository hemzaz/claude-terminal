import { describe, it, expect } from 'vitest';
import {
  getDragData,
  isTerminalDrag,
  TERMINAL_DRAG_TYPE,
  type DragPayload,
} from '../utils/dragDrop';

// Minimal DragEvent stub — only the dataTransfer fields these functions touch.
function makeDragEvent(opts: {
  data?: Record<string, string>;
  types?: string[];
}): unknown {
  const { data = {}, types = Object.keys(data) } = opts;
  return {
    dataTransfer: {
      getData: (type: string) => data[type] ?? '',
      types,
    },
  };
}

describe('getDragData', () => {
  it('returns null when dataTransfer carries no data for the mime type', () => {
    const event = makeDragEvent({ data: {} });
    expect(getDragData(event as React.DragEvent)).toBeNull();
  });

  it('returns null when the stored value is an empty string', () => {
    const event = makeDragEvent({ data: { [TERMINAL_DRAG_TYPE]: '' } });
    expect(getDragData(event as React.DragEvent)).toBeNull();
  });

  it('returns null when the stored value is malformed JSON', () => {
    const event = makeDragEvent({ data: { [TERMINAL_DRAG_TYPE]: '{bad json' } });
    expect(getDragData(event as React.DragEvent)).toBeNull();
  });

  it('parses and returns a valid DragPayload from the event', () => {
    const payload: DragPayload = { terminalId: 'abc-123', source: 'sidebar' };
    const event = makeDragEvent({
      data: { [TERMINAL_DRAG_TYPE]: JSON.stringify(payload) },
    });
    expect(getDragData(event as React.DragEvent)).toEqual(payload);
  });

  it('preserves optional sourceIndex when present', () => {
    const payload: DragPayload = { terminalId: 'xyz', source: 'grid', sourceIndex: 3 };
    const event = makeDragEvent({
      data: { [TERMINAL_DRAG_TYPE]: JSON.stringify(payload) },
    });
    expect(getDragData(event as React.DragEvent)).toEqual(payload);
  });
});

describe('isTerminalDrag', () => {
  it('returns true when the event types list includes the terminal mime type', () => {
    const event = makeDragEvent({ types: [TERMINAL_DRAG_TYPE] });
    expect(isTerminalDrag(event as React.DragEvent)).toBe(true);
  });

  it('returns false when the event types list is empty', () => {
    const event = makeDragEvent({ types: [] });
    expect(isTerminalDrag(event as React.DragEvent)).toBe(false);
  });

  it('returns false when types contains unrelated mime types only', () => {
    const event = makeDragEvent({ types: ['text/plain', 'text/html'] });
    expect(isTerminalDrag(event as React.DragEvent)).toBe(false);
  });

  it('returns true even when mixed with other types', () => {
    const event = makeDragEvent({ types: ['text/plain', TERMINAL_DRAG_TYPE] });
    expect(isTerminalDrag(event as React.DragEvent)).toBe(true);
  });
});
