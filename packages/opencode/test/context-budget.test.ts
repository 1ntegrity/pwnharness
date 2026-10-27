import { describe, expect, test } from "bun:test"
import { buildCappedOutput, OUTPUT_HARD_CAP } from "@/session/small-model"

describe("C-4 output cap quantified on a realistic dump", () => {
  test("a 50KB dump enters the transcript at ~16KB, full text kept by ref", () => {
    const dump = "open port line\n".repeat(3500) // ~52KB, like a big build/test log dump
    expect(dump.length).toBeGreaterThan(50_000)
    const { output, metadataPatch } = buildCappedOutput(dump, "/refs/scan-abc")
    const saved = dump.length - output.length
    console.log(`[C-4] raw ${dump.length} bytes -> transcript ${output.length} bytes (saved ${saved}, ${((saved / dump.length) * 100).toFixed(0)}% off the hot path); full text at ${metadataPatch.outputPath}`)
    expect(output.length).toBeLessThan(dump.length / 2) // >50% off the transcript
    expect(output.slice(0, OUTPUT_HARD_CAP)).toBe(dump.slice(0, OUTPUT_HARD_CAP)) // head intact
    expect(metadataPatch.outputPath).toBe("/refs/scan-abc") // retrievable
    expect(OUTPUT_HARD_CAP).toBe(16000)
  })
})
