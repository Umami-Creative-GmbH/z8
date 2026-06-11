export type NotificationStreamEvent = "new_notification" | "count_update";

export interface RegisteredClient {
  id: string;
  userId: string;
  organizationId: string;
  send: (event: NotificationStreamEvent, data: unknown) => void;
}

export class ClientRegistry {
  private readonly clients = new Map<string, RegisteredClient>();
  private readonly byUser = new Map<string, Set<string>>();

  add(client: RegisteredClient): void {
    this.remove(client.id);
    this.clients.set(client.id, client);
    const ids = this.byUser.get(client.userId) ?? new Set<string>();
    ids.add(client.id);
    this.byUser.set(client.userId, ids);
  }

  remove(id: string): void {
    const client = this.clients.get(id);
    if (!client) return;
    this.clients.delete(id);
    const ids = this.byUser.get(client.userId);
    ids?.delete(id);
    if (ids?.size === 0) this.byUser.delete(client.userId);
  }

  fanout(userId: string, event: NotificationStreamEvent, data: unknown): number {
    const organizationId = typeof data === "object" && data && "organizationId" in data ? data.organizationId : null;
    if (typeof organizationId !== "string") return 0;
    let count = 0;
    for (const id of this.byUser.get(userId) ?? []) {
      const client = this.clients.get(id);
      if (!client || client.organizationId !== organizationId) continue;
      client.send(event, data);
      count += 1;
    }
    return count;
  }
}
