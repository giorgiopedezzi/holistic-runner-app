// HRA-184: @garmin/fitsdk 21.214.0 ships .d.ts files with extensionless
// relative imports (its own "type": "module" package, importing e.g.
// `from "./stream"` instead of `from "./stream.js"`), which this project's
// `moduleResolution: NodeNext` rejects (TS2834) — a packaging defect in the
// upstream package, confirmed by direct isolated repro, not a mistake in our
// own config. The runtime import (`import { Decoder } from "@garmin/fitsdk"`)
// works correctly in Node; only TypeScript's static resolution of the
// shipped .d.ts graph fails. This shim declares just the surface this repo
// actually uses, verified against the installed package's src/profile.js and
// src/*.js (see integrations/garmin-workout.ts) so it stays load-bearing
// rather than a blanket `any`.
declare module "@garmin/fitsdk" {
  export class Stream {
    static fromBuffer(buffer: Buffer): Stream;
    static fromByteArray(bytes: number[]): Stream;
    static fromArrayBuffer(buffer: ArrayBuffer): Stream;
  }

  export class Decoder {
    constructor(stream: Stream);
    static isFIT(stream: Stream): boolean;
    isFIT(): boolean;
    checkIntegrity(): boolean;
    read(options?: Record<string, unknown>): {
      messages: Record<string, unknown[]>;
      errors: unknown[];
    };
  }

  export class Encoder {
    constructor(options?: { fieldDescriptions?: Record<string, unknown> | null });
    writeMesg(mesg: Record<string, unknown>): Encoder;
    onMesg(mesgNum: number, mesg: Record<string, unknown>): Encoder;
    close(): Uint8Array;
  }

  export const Profile: {
    MesgNum: Record<string, number>;
    [key: string]: unknown;
  };

  export const Utils: Record<string, unknown>;
}
