/**
 * Service cards (REQ-104, ADR-0127): a catalog card somebody saved with the name and damage numbers they kept. The
 * catalog lists the viewer's own cards and everybody's shared ones. Only the owner changes who may see or edit a card
 * and deletes it. A card is always locked: everybody else copies it into a card of their own (REQ-108, ADR-0131).
 */
import type {
  CopyServiceCardRequest,
  CreateServiceCardRequest,
  ServiceCardView,
  UpdateServiceCardRequest,
} from "@terrarium/core/contract";
import { ForbiddenError, InvalidInputError } from "@terrarium/core/contract";
import type { ServiceCardRecord } from "@terrarium/core/experiments";
import { catalogCard, loadProblem } from "@terrarium/core/world";
import { must, ownerOnly, type PlatformContext, type Viewer } from "./context";
import type { Titles } from "./titles";

const canEdit = (viewer: Viewer, c: ServiceCardRecord): boolean => c.owner === viewer.name;

/** The numbers a card carries must be sayable (REQ-109): the schema checks the shape, this the meaning. */
function checkLoad(load: CreateServiceCardRequest["load"]): void {
  const problem = load ? loadProblem(load) : undefined;
  if (problem)
    throw new InvalidInputError("서비스 숫자를 확인해 주세요", [
      { path: "load", message: problem },
    ]);
}

export class ServiceCards {
  constructor(
    private readonly ctx: PlatformContext,
    private readonly titles?: Titles,
  ) {}

  private async views(
    viewer: Viewer,
    list: readonly ServiceCardRecord[],
  ): Promise<ServiceCardView[]> {
    const owned = this.titles ? await this.titles.ofMany(list.map((c) => c.owner)) : new Map();
    return list.map((c) => ({
      id: c.id,
      name: c.name,
      card: c.card,
      ...(c.harm ? { harm: c.harm } : {}),
      ...(c.load ? { load: c.load } : {}),
      owner: c.owner,
      ownerTitles: owned.get(c.owner) ?? [],
      shared: c.shared,
      canEdit: canEdit(viewer, c),
      createdAt: c.createdAt,
    }));
  }

  async list(viewer: Viewer): Promise<ServiceCardView[]> {
    const all = await this.ctx.store.listServiceCards();
    return this.views(
      viewer,
      all.filter((c) => c.shared || c.owner === viewer.name),
    );
  }

  private async one(viewer: Viewer, record: ServiceCardRecord): Promise<ServiceCardView> {
    return (await this.views(viewer, [record]))[0] as ServiceCardView;
  }

  async create(viewer: Viewer, input: CreateServiceCardRequest): Promise<ServiceCardView> {
    const base = must(catalogCard(input.card), "기본 제공 카드");
    if (input.harm && input.harm.length !== base.tiers.length)
      throw new InvalidInputError("피해 등급을 확인해 주세요", [
        { path: "harm", message: `피해 등급은 ${base.tiers.length}개여야 해요` },
      ]);
    checkLoad(input.load);
    const record: ServiceCardRecord = {
      id: this.ctx.stamps.id("sc"),
      owner: viewer.name,
      name: input.name,
      card: input.card,
      ...(input.harm ? { harm: input.harm } : {}),
      ...(input.load ? { load: input.load } : {}),
      shared: input.shared,
      createdAt: this.ctx.stamps.now(),
    };
    await this.ctx.store.putServiceCard(record);
    return this.one(viewer, record);
  }

  async update(
    viewer: Viewer,
    id: string,
    input: UpdateServiceCardRequest,
  ): Promise<ServiceCardView> {
    const old = must(await this.ctx.store.getServiceCard(id), "서비스 카드");
    if (!old.shared && old.owner !== viewer.name)
      throw new ForbiddenError("공유되지 않은 카드예요");
    if (!canEdit(viewer, old))
      throw new ForbiddenError(
        `카드는 만든 사람(${old.owner})만 고칠 수 있어요. 복사해서 내 카드로 쓰세요`,
      );
    const base = must(catalogCard(old.card), "기본 제공 카드");
    if (input.harm && input.harm.length !== base.tiers.length)
      throw new InvalidInputError("피해 등급을 확인해 주세요", [
        { path: "harm", message: `피해 등급은 ${base.tiers.length}개여야 해요` },
      ]);
    checkLoad(input.load);
    const saved: ServiceCardRecord = {
      ...old,
      name: input.name ?? old.name,
      ...(input.harm ? { harm: input.harm } : {}),
      ...(input.load ? { load: input.load } : {}),
      shared: input.shared ?? old.shared,
      updatedAt: this.ctx.stamps.now(),
    };
    await this.ctx.store.putServiceCard(saved);
    return this.one(viewer, saved);
  }

  /** A shared card (or my own) copied into a new card owned by whoever copies it, not shared yet. */
  async copy(viewer: Viewer, id: string, input: CopyServiceCardRequest): Promise<ServiceCardView> {
    const old = must(await this.ctx.store.getServiceCard(id), "서비스 카드");
    if (!old.shared && old.owner !== viewer.name)
      throw new ForbiddenError("공유되지 않은 카드예요");
    const record: ServiceCardRecord = {
      id: this.ctx.stamps.id("sc"),
      owner: viewer.name,
      name: input.name ?? old.name,
      card: old.card,
      ...(old.harm ? { harm: old.harm } : {}),
      ...(old.load ? { load: old.load } : {}),
      shared: false,
      createdAt: this.ctx.stamps.now(),
    };
    await this.ctx.store.putServiceCard(record);
    return this.one(viewer, record);
  }

  async remove(viewer: Viewer, id: string): Promise<{ readonly deleted: boolean }> {
    const old = must(await this.ctx.store.getServiceCard(id), "서비스 카드");
    ownerOnly(viewer, old.owner, "지우기");
    await this.ctx.store.deleteServiceCard(id);
    return { deleted: true };
  }
}
