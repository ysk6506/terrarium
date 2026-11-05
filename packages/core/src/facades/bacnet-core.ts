/**
 * BACnet vocabulary (ANSI/ASHRAE 135): object types, property identifiers, engineering units, error
 * classes and codes, and the JSON shape of an application-tagged value. The numbers are the standard's,
 * as published in the open-source bacnet-stack's `bacenum.h`; a test checks the ones used here (ADR-0057).
 */

export type ObjectType =
  | "analog-input"
  | "analog-value"
  | "binary-input"
  | "binary-output"
  | "multi-state-input"
  | "device";

export const OBJECT_TYPE_ID: Readonly<Record<ObjectType, number>> = {
  "analog-input": 0,
  "analog-value": 2,
  "binary-input": 3,
  "binary-output": 4,
  "multi-state-input": 13,
  device: 8,
};

export const PROPERTY_ID = {
  "active-text": 4,
  "application-software-version": 12,
  description: 28,
  "event-state": 36,
  "firmware-revision": 44,
  "inactive-text": 46,
  location: 58,
  "max-apdu-length-accepted": 62,
  "model-name": 70,
  "number-of-states": 74,
  "object-identifier": 75,
  "object-list": 76,
  "object-name": 77,
  "object-type": 79,
  "out-of-service": 81,
  polarity: 84,
  "present-value": 85,
  "priority-array": 87,
  "protocol-version": 98,
  reliability: 103,
  "relinquish-default": 104,
  "segmentation-supported": 107,
  "state-text": 110,
  "status-flags": 111,
  "system-status": 112,
  units: 117,
  "vendor-identifier": 120,
  "vendor-name": 121,
  "protocol-revision": 139,
  "database-revision": 155,
} as const;

export type PropertyName = keyof typeof PROPERTY_ID;

export const UNITS = {
  amperes: 3,
  "degrees-celsius": 62,
  kilowatts: 48,
  percent: 98,
  "no-units": 95,
} as const;

export type UnitName = keyof typeof UNITS;

export const ERROR_CLASS = {
  device: 0,
  object: 1,
  property: 2,
  resources: 3,
  security: 4,
  services: 5,
} as const;

export const ERROR_CODE = {
  "invalid-array-index": 42,
  "invalid-data-type": 9,
  "parameter-out-of-range": 80,
  "property-is-not-an-array": 50,
  "unknown-object": 31,
  "unknown-property": 32,
  "value-out-of-range": 37,
  "write-access-denied": 40,
} as const;

export interface BacnetError {
  readonly errorClass: keyof typeof ERROR_CLASS;
  readonly errorCode: keyof typeof ERROR_CODE;
  readonly message: string;
}

export const bacnetError = (
  errorClass: BacnetError["errorClass"],
  errorCode: BacnetError["errorCode"],
  message: string,
): BacnetError => ({ errorClass, errorCode, message });

/** A value with its application tag, as a client prints it. */
export type AppValue =
  | { readonly type: "null" }
  | { readonly type: "boolean"; readonly value: boolean }
  | { readonly type: "unsigned"; readonly value: number }
  | { readonly type: "real"; readonly value: number }
  | { readonly type: "character-string"; readonly value: string }
  | { readonly type: "enumerated"; readonly value: number; readonly name?: string }
  | { readonly type: "bit-string"; readonly value: Readonly<Record<string, boolean>> }
  | {
      readonly type: "object-identifier";
      readonly value: { readonly objectType: ObjectType; readonly instance: number };
    }
  | { readonly type: "array"; readonly value: readonly AppValue[] };

export const real = (value: number): AppValue => ({
  type: "real",
  value: Math.round(value * 100) / 100,
});
export const unsigned = (value: number): AppValue => ({
  type: "unsigned",
  value: Math.round(value),
});
export const text = (value: string): AppValue => ({ type: "character-string", value });
export const bool = (value: boolean): AppValue => ({ type: "boolean", value });
export const enumerated = (value: number, name?: string): AppValue => ({
  type: "enumerated",
  value,
  ...(name ? { name } : {}),
});
export const objectId = (objectType: ObjectType, instance: number): AppValue => ({
  type: "object-identifier",
  value: { objectType, instance },
});

/** How a client may spell a property: the standard's kebab-case name, camelCase, snake_case, or the number. */
export function propertyOf(spelling: string | number): PropertyName | undefined {
  const names = Object.keys(PROPERTY_ID) as PropertyName[];
  if (typeof spelling === "number" || /^\d+$/.test(String(spelling)))
    return names.find((n) => PROPERTY_ID[n] === Number(spelling));
  const kebab = String(spelling)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
  return names.find((n) => n === kebab);
}

export function objectTypeOf(spelling: string | number): ObjectType | undefined {
  const types = Object.keys(OBJECT_TYPE_ID) as ObjectType[];
  if (typeof spelling === "number" || /^\d+$/.test(String(spelling)))
    return types.find((t) => OBJECT_TYPE_ID[t] === Number(spelling));
  const kebab = String(spelling)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
  return types.find((t) => t === kebab);
}

/** One thing a BACnet device exposes. Commandable objects take writes at a priority (1 highest to 16 lowest). */
export interface BacnetObject {
  readonly type: ObjectType;
  readonly instance: number;
  readonly name: string;
  readonly description: string;
  /** The present value as the world has it. */
  readonly present: AppValue;
  readonly units?: UnitName;
  readonly activeText?: string;
  readonly inactiveText?: string;
  readonly stateText?: readonly string[];
  /** In alarm: the world has an active alarm on this equipment. */
  readonly inAlarm?: boolean;
  /** Present for a commandable object: the value to use when no priority slot holds one, and how to apply a value. */
  readonly commandable?: {
    readonly relinquishDefault: AppValue;
    /** Checks a value from the client; returns an error, or the value as the world takes it. */
    readonly accept: (value: unknown) => BacnetError | number;
    readonly apply: (value: number) => void;
  };
}
