import { InvalidValueError, josa } from "@terrarium/core/kernel";

/** A secret from the environment, or an error that says which variable to set. */
export function secret(env: NodeJS.ProcessEnv, name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const value = env[name];
  if (value === undefined || value === "")
    throw new InvalidValueError(
      `환경 변수 ${name}${josa(name, "이")} 비어 있어요 (설정 파일이 이 이름을 가리켜요)`,
    );
  return value;
}
