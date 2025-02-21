import { HEARTBEAT_EVENTS } from "@walletconnect/heartbeat";
import { generateChildLogger, getLoggerContext } from "@walletconnect/logger";
import { toMiliseconds } from "@walletconnect/time";
import { ExpirerTypes, ICore, IExpirer } from "@walletconnect/types";
import { ERROR } from "@walletconnect/utils";
import { EventEmitter } from "events";
import { Logger } from "pino";
import {
  SIGN_CLIENT_STORAGE_PREFIX,
  EXPIRER_CONTEXT,
  EXPIRER_EVENTS,
  EXPIRER_STORAGE_VERSION,
} from "../constants";

export class Expirer extends IExpirer {
  public expirations = new Map<string, ExpirerTypes.Expiration>();
  public events = new EventEmitter();
  public name = EXPIRER_CONTEXT;
  public version = EXPIRER_STORAGE_VERSION;

  private cached: ExpirerTypes.Expiration[] = [];
  private initialized = false;

  private storagePrefix = SIGN_CLIENT_STORAGE_PREFIX;

  constructor(public core: ICore, public logger: Logger) {
    super(core, logger);
    this.core;
    this.logger = generateChildLogger(logger, this.name);
  }

  public init: IExpirer["init"] = async () => {
    if (!this.initialized) {
      this.logger.trace(`Initialized`);
      await this.restore();
      this.cached.forEach(expiration => this.expirations.set(expiration.target, expiration));
      this.cached = [];
      this.registerEventListeners();
      this.initialized = true;
    }
  };

  get context(): string {
    return getLoggerContext(this.logger);
  }

  get storageKey(): string {
    return this.storagePrefix + this.version + "//" + this.name;
  }

  get length(): number {
    return this.expirations.size;
  }

  get keys(): string[] {
    return Array.from(this.expirations.keys());
  }

  get values(): ExpirerTypes.Expiration[] {
    return Array.from(this.expirations.values());
  }

  public has: IExpirer["has"] = target => {
    try {
      const expiration = this.getExpiration(target);
      return typeof expiration !== "undefined";
    } catch (e) {
      // ignore
      return false;
    }
  };

  public set: IExpirer["set"] = (target, expiration) => {
    this.isInitialized();
    this.expirations.set(target, expiration);
    this.checkExpiry(target, expiration);
    this.events.emit(EXPIRER_EVENTS.created, {
      target,
      expiration,
    } as ExpirerTypes.Created);
  };

  public get: IExpirer["get"] = target => {
    this.isInitialized();
    return this.getExpiration(target);
  };

  public del: IExpirer["del"] = async target => {
    this.isInitialized();
    const exists = await this.has(target);
    if (exists) {
      const expiration = this.getExpiration(target);
      this.expirations.delete(target);
      this.events.emit(EXPIRER_EVENTS.deleted, {
        target,
        expiration,
      } as ExpirerTypes.Deleted);
    }
  };

  public on: IExpirer["on"] = (event, listener) => {
    this.events.on(event, listener);
  };

  public once: IExpirer["once"] = (event, listener) => {
    this.events.once(event, listener);
  };

  public off: IExpirer["off"] = (event, listener) => {
    this.events.off(event, listener);
  };

  public removeListener: IExpirer["removeListener"] = (event, listener) => {
    this.events.removeListener(event, listener);
  };

  // ---------- Private ----------------------------------------------- //

  private async setExpirations(expirations: ExpirerTypes.Expiration[]): Promise<void> {
    await this.core.storage.setItem<ExpirerTypes.Expiration[]>(this.storageKey, expirations);
  }

  private async getExpirations(): Promise<ExpirerTypes.Expiration[] | undefined> {
    const expirations = await this.core.storage.getItem<ExpirerTypes.Expiration[]>(this.storageKey);
    return expirations;
  }

  private async persist() {
    await this.setExpirations(this.values);
    this.events.emit(EXPIRER_EVENTS.sync);
  }

  private async restore() {
    try {
      const persisted = await this.getExpirations();
      if (typeof persisted === "undefined") return;
      if (!persisted.length) return;
      if (this.expirations.size) {
        const error = ERROR.RESTORE_WILL_OVERRIDE.format({
          context: this.name,
        });
        this.logger.error(error.message);
        throw new Error(error.message);
      }
      this.cached = persisted;
      this.logger.debug(`Successfully Restored expirations for ${this.name}`);
      this.logger.trace({ type: "method", method: "restore", expirations: this.values });
    } catch (e) {
      this.logger.debug(`Failed to Restore expirations for ${this.name}`);
      this.logger.error(e as any);
    }
  }

  private getExpiration(target: string): ExpirerTypes.Expiration {
    const expiration = this.expirations.get(target);
    if (!expiration) {
      const error = ERROR.NO_MATCHING_ID.format({
        context: this.name,
        target,
      });
      // this.logger.error(error.message);
      throw new Error(error.message);
    }
    return expiration;
  }

  private checkExpiry(target: string, expiration: ExpirerTypes.Expiration): void {
    const { expiry } = expiration;
    const msToTimeout = toMiliseconds(expiry) - Date.now();
    if (msToTimeout <= 0) this.expire(target, expiration);
  }

  private expire(target: string, expiration: ExpirerTypes.Expiration): void {
    this.expirations.delete(target);
    this.events.emit(EXPIRER_EVENTS.expired, {
      target,
      expiration,
    } as ExpirerTypes.Expired);
  }

  private checkExpirations(): void {
    this.expirations.forEach((expiration, target) => this.checkExpiry(target, expiration));
  }

  private registerEventListeners(): void {
    this.core.heartbeat.on(HEARTBEAT_EVENTS.pulse, () => this.checkExpirations());
    this.events.on(EXPIRER_EVENTS.created, (createdEvent: ExpirerTypes.Created) => {
      const eventName = EXPIRER_EVENTS.created;
      this.logger.info(`Emitting ${eventName}`);
      this.logger.debug({ type: "event", event: eventName, data: createdEvent });
      this.persist();
    });
    this.events.on(EXPIRER_EVENTS.expired, (expiredEvent: ExpirerTypes.Expired) => {
      const eventName = EXPIRER_EVENTS.expired;
      this.logger.info(`Emitting ${eventName}`);
      this.logger.debug({ type: "event", event: eventName, data: expiredEvent });
      this.persist();
    });
    this.events.on(EXPIRER_EVENTS.deleted, (deletedEvent: ExpirerTypes.Deleted) => {
      const eventName = EXPIRER_EVENTS.deleted;
      this.logger.info(`Emitting ${eventName}`);
      this.logger.debug({ type: "event", event: eventName, data: deletedEvent });
      this.persist();
    });
  }

  private isInitialized() {
    if (!this.initialized) {
      throw new Error(ERROR.NOT_INITIALIZED.stringify(this.name));
    }
  }
}
