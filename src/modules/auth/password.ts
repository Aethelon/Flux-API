import { randomBytes, scrypt, timingSafeEqual } from "node:crypto"

const VERSION = 1
const COST = 32_768
const BLOCK_SIZE = 8
const PARALLELIZATION = 1
const KEY_LENGTH = 64
const MAX_MEMORY = 64 * 1024 * 1024

function deriveKey(
  password: string,
  salt: Buffer,
  cost: number,
  blockSize: number,
  parallelization: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      {
        N: cost,
        r: blockSize,
        p: parallelization,
        maxmem: MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error)
          return
        }

        resolve(derivedKey)
      },
    )
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derivedKey = await deriveKey(password, salt, COST, BLOCK_SIZE, PARALLELIZATION)

  return [
    "scrypt",
    `v=${String(VERSION)}`,
    `N=${String(COST)}`,
    `r=${String(BLOCK_SIZE)}`,
    `p=${String(PARALLELIZATION)}`,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$")
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const parts = encodedHash.split("$")
  if (parts.length !== 7 || parts[0] !== "scrypt" || parts[1] !== `v=${String(VERSION)}`) {
    return false
  }

  const cost = Number(parts[2]?.slice(2))
  const blockSize = Number(parts[3]?.slice(2))
  const parallelization = Number(parts[4]?.slice(2))

  if (
    !Number.isInteger(cost)
    || !Number.isInteger(blockSize)
    || !Number.isInteger(parallelization)
    || cost !== COST
    || blockSize !== BLOCK_SIZE
    || parallelization !== PARALLELIZATION
  ) {
    return false
  }

  try {
    const salt = Buffer.from(parts[5] ?? "", "base64url")
    const expected = Buffer.from(parts[6] ?? "", "base64url")
    const actual = await deriveKey(password, salt, cost, blockSize, parallelization)

    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}
