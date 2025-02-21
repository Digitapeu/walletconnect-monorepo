import { Logger } from "pino";
import { IEvents } from "@walletconnect/events";

import { ICore } from "../core/core";

export declare namespace ExpirerTypes {
  interface Expiration {
    target: string;
    expiry: number;
  }

  interface Created {
    target: string;
    expiration: Expiration;
  }

  interface Deleted {
    target: string;
    expiration: Expiration;
  }

  interface Expired {
    target: string;
    expiration: Expiration;
  }
}

export abstract class IExpirer extends IEvents {
  public abstract name: string;

  public abstract readonly context: string;

  public abstract readonly length: number;

  public abstract readonly keys: string[];

  public abstract readonly values: ExpirerTypes.Expiration[];

  constructor(public core: ICore, public logger: Logger) {
    super();
  }

  public abstract init(): Promise<void>;

  public abstract has(target: string): boolean;

  public abstract set(target: string, expiration: ExpirerTypes.Expiration): void;

  public abstract get(target: string): ExpirerTypes.Expiration;

  public abstract del(target: string): Promise<void>;
}
