/**
 * Service cards (REQ-104, ADR-0127): a catalog card somebody saved with the name and damage numbers they kept. The
 * catalog lists the viewer's own cards and everybody's shared ones. Only the owner changes who may see or edit a card
 * and deletes it; a card that is not locked may have its name and numbers changed by anyone.
 */
import type {
  CreateServiceCardRequest,
  ServiceCardView,
  UpdateServiceCardRequest,
} from "@terrarium/core/contract";
import { ForbiddenError, InvalidInputError } from "@terrarium/core/contract";
import type { ServiceCardRecord } from "@terrarium/core/experiments";
import { catalogCard } from "@terrarium/core/world";
import { must, ownerOnly, type PlatformContext, type Viewer } from "./context";
import type { Titles } from "./titles";

const canEdit = (viewer: Viewer, c: ServiceCardRecord): boolean =>
  c.owner === viewer.name || !c.locked;

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
      owner: c.owner,
      ownerTitles: owned.get(c.owner) ?? [],
      locked: c.locked,
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
    const record: ServiceCardRecord = {
      id: this.ctx.stamps.id("sc"),
      owner: viewer.name,
      name: input.name,
      card: input.card,
      ...(input.harm ? { harm: input.harm } : {}),
      locked: input.locked,
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
    const sharing = input.shared !== undefined || input.locked !== undefined;
    if (sharing) ownerOnly(viewer, old.owner, "공유·잠금 바꾸기");
    else if (!canEdit(viewer, old))
      throw new ForbiddenError(
        `잠긴 카드는 만든 사람(${old.owner})만 고칠 수 있어요. 복사해서 쓰세요`,
      );
    const base = must(catalogCard(old.card), "기본 제공 카드");
    if (input.harm && input.harm.length !== base.tiers.length)
      throw new InvalidInputError("피해 등급을 확인해 주세요", [
        { path: "harm", message: `피해 등급은 ${base.tiers.length}개여야 해요` },
      ]);
    const saved: ServiceCardRecord = {
      ...old,
      name: input.name ?? old.name,
      ...(input.harm ? { harm: input.harm } : {}),
      locked: input.locked ?? old.locked,
      shared: input.shared ?? old.shared,
      updatedAt: this.ctx.stamps.now(),
    };
    await this.ctx.store.putServiceCard(saved);
    return this.one(viewer, saved);
  }

  async remove(viewer: Viewer, id: string): Promise<{ readonly deleted: boolean }> {
    const old = must(await this.ctx.store.getServiceCard(id), "서비스 카드");
    ownerOnly(viewer, old.owner, "지우기");
    await this.ctx.store.deleteServiceCard(id);
    return { deleted: true };
  }
}
