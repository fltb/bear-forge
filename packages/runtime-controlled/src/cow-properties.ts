import {CowStore} from './cow-store.ts';

export const propertyPageWidth = 32;
export const dataProperty = 1;
export const writableProperty = 2;
const enumerableProperty = 4, configurableProperty = 8;
type Layout = {readonly key: PropertyKey; readonly order: number; readonly flags: number};
type Page = {owner: object | undefined; layout: (Layout | undefined)[]; values: unknown[]; setters: unknown[] | undefined; ownLayout: boolean; count: number};
const clonePage = (page: Page): Page => ({owner: undefined, layout: page.layout, values: page.values.slice(), setters: page.setters?.slice(), ownLayout: false, count: page.count});

/** Property metadata never holds authored values or accessor functions.
 * A shared value write clones at most one 32-slot page (32 value entries and optional setters),
 * keeping its layout shared. Structural edits detach that page's layout too.
 * The page index is persistent; fork neither scans pages nor copies values. */
export class CowProperties {
  shapeVersion = 0;
  private owner: object = {};
  private first: Page | undefined;
  private pages: CowStore<Page> | undefined;
  read(slot: number): Page | undefined {
    return slot < propertyPageWidth ? this.first : this.pages?.get(Math.floor(slot / propertyPageWidth));
  }
  layout(slot: number): Layout | undefined { return this.read(slot)?.layout[slot % propertyPageWidth]; }
  descriptor(slot: number): PropertyDescriptor | undefined {
    const page = this.read(slot), offset = slot % propertyPageWidth, layout = page?.layout[offset];
    if (!layout) return undefined;
    const flags = layout.flags;
    return flags & dataProperty
      ? {value: page!.values[offset], writable: !!(flags & writableProperty), enumerable: !!(flags & enumerableProperty), configurable: !!(flags & configurableProperty)}
      : {get: page!.values[offset] as (() => unknown), set: page!.setters?.[offset] as ((value: unknown) => void),
        enumerable: !!(flags & enumerableProperty), configurable: !!(flags & configurableProperty)};
  }
  private edit(slot: number): Page {
    if (slot < propertyPageWidth) {
      if (this.first?.owner === this.owner) return this.first;
      const page: Page = this.first ? clonePage(this.first) : {owner: undefined, layout: [], values: [], setters: undefined, ownLayout: true, count: 0};
      page.owner = this.owner;
      return this.first = page;
    }
    const index = Math.floor(slot / propertyPageWidth);
    const pages = this.pages ??= new CowStore<Page>();
    if (pages.has(index)) return pages.edit(index, clonePage);
    const page: Page = {owner: undefined, layout: [], values: [], setters: undefined, ownLayout: true, count: 0};
    pages.set(index, page);
    return page;
  }
  define(slot: number, key: PropertyKey, order: number, descriptor: PropertyDescriptor): void {
    const page = this.edit(slot), offset = slot % propertyPageWidth;
    const flags = ('value' in descriptor ? dataProperty : 0) | (descriptor.writable ? writableProperty : 0)
      | (descriptor.enumerable ? enumerableProperty : 0) | (descriptor.configurable ? configurableProperty : 0);
    const previous = page.layout[offset];
    if (!previous || previous.flags !== flags || previous.key !== key || previous.order !== order) {
      if (!page.ownLayout) { page.layout = page.layout.slice(); page.ownLayout = true; }
      if (!previous) { page.count++; this.shapeVersion++; }
      page.layout[offset] = {key, order, flags};
    }
    page.values[offset] = flags & dataProperty ? descriptor.value : descriptor.get;
    if (flags & dataProperty) { if (page.setters) page.setters[offset] = undefined; }
    else if (descriptor.set !== undefined || page.setters) (page.setters ??= [])[offset] = descriptor.set;
  }
  setValue(slot: number, value: unknown): void {
    this.edit(slot).values[slot % propertyPageWidth] = value;
  }
  delete(slot: number): void {
    if (!this.layout(slot)) return;
    const page = this.edit(slot), offset = slot % propertyPageWidth;
    this.shapeVersion++;
    if (!page.ownLayout) { page.layout = page.layout.slice(); page.ownLayout = true; }
    page.layout[offset] = undefined;
    page.values[offset] = undefined;
    if (page.setters) page.setters[offset] = undefined;
    if (--page.count === 0) {
      if (slot < propertyPageWidth) this.first = undefined;
      else {
        this.pages!.delete(Math.floor(slot / propertyPageWidth));
        if (!this.pages!.size) this.pages = undefined;
      }
    }
  }
  fork(): CowProperties {
    const branch = new CowProperties();
    branch.first = this.first;
    branch.shapeVersion = this.shapeVersion;
    branch.pages = this.pages?.fork();
    this.owner = {};
    return branch;
  }
  *entries(): IterableIterator<[number, Layout]> {
    if (this.first) for (let offset = 0; offset < this.first.layout.length; offset++) {
      const layout = this.first.layout[offset];
      if (layout) yield [offset, layout];
    }
    if (!this.pages) return;
    for (const [index, page] of this.pages.entries()) {
      for (let offset = 0; offset < page.layout.length; offset++) {
        const layout = page.layout[offset];
        if (layout) yield [index * propertyPageWidth + offset, layout];
      }
    }
  }
}
