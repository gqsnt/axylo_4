import { Labels } from "./labels";
import { StoreMap } from "./store-map";
import { XParser, type DateUnit } from "./x";

export class StreamParser extends XParser {
  declare protected names: Labels | null;
  declare protected index: StoreMap<string, number> | null;

  protected override loadCategories(categories: readonly string[]): void {
    this.names = new Labels(categories);
    this.index = new StoreMap(categories.map((name, i) => [name, i]));
  }

  static from(parser: XParser): StreamParser {
    const copy = Object.assign(Object.create(StreamParser.prototype) as StreamParser, parser);
    if (parser.kind === "category") copy.loadCategories(parser.categories!);
    return copy;
  }

  override get categories(): readonly string[] | null {
    return this.names?.view() ?? null;
  }

  get categoryCount(): number {
    return this.names?.length ?? 0;
  }

  categoryName(position: number): string | undefined {
    return this.names?.at(position - this.base);
  }

  fork(): StreamParser {
    return Object.assign(Object.create(StreamParser.prototype) as StreamParser, this, {
      names: this.names?.fork() ?? null,
      index: this.index?.fork() ?? null,
    });
  }

  commit(): void {
    if (this.index) this.index = this.index.commit();
  }

  evictCategories(count: number): void {
    if (!this.names) return;
    for (let i = 0; i < count; i++) this.index!.delete(this.names.at(i));
    this.base += count;
    this.names.drop(count);
  }

  restore(categoryCount: number, dateUnit: DateUnit | null): void {
    this.dateUnit = dateUnit;
    if (!this.names) return;
    while (this.categoryCount > categoryCount) this.index!.delete(this.names.pop()!);
  }
}
