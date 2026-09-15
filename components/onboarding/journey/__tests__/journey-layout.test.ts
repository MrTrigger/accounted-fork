import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

// The journey is a fixed, non-scrolling scene: a step that outgrows its box has
// to give up space somewhere, and the one thing it must never give up is its
// own primary action (#2642). The three invariants below are what keep the
// button reachable; they live in CSS, so a unit test can only guard the shape.
const dir = path.resolve(__dirname, '..')
const css = readFileSync(path.join(dir, 'journey.css'), 'utf8')
const journey = readFileSync(path.join(dir, 'OnboardingJourney.tsx'), 'utf8')

/** The declarations of the rule that starts with this selector, comments out. */
function ruleFor(selector: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const at = stripped.indexOf(selector)
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1)
  const open = stripped.indexOf('{', at)
  return stripped.slice(open + 1, stripped.indexOf('}', open))
}

describe('journey step layout', () => {
  it('sizes the question area from its content so the balance spacer yields first', () => {
    // With flex-basis 0 the line never overflows, so .jny-balance keeps its
    // 180px while the step is clipped: the button ends up below the clip edge
    // with free space still on screen underneath it.
    expect(ruleFor('.jny-qarea')).toMatch(/flex:\s*1\s+1\s+auto/)
  })

  it('seats the action row at the bottom of the step it belongs to', () => {
    // Sticky only travels inside its own containing block, so the sticky child
    // has to be the row itself or the wrapper around it. Nested deeper it has
    // nowhere to travel and the row is clipped again.
    const rule = ruleFor('.jny-qstep > .jny-qactions')
    expect(rule).toMatch(/position:\s*sticky/)
    expect(rule).toMatch(/bottom:\s*0/)
    expect(css).toMatch(/\.jny-qstep > \.jny-reveal/)
  })

  it('does not nest a second scroll box around the delayed action row', () => {
    // Reveal wraps the done scene's continue button. A nested .jny-qstep is a
    // scroll box inside a scroll box, which clips the row it wraps.
    const reveal = journey.slice(journey.indexOf('function Reveal('))
    const body = reveal.slice(0, reveal.indexOf('\nfunction ', 1))
    expect(body).toContain('jny-reveal')
    expect(body).not.toContain('jny-qstep')
  })
})
