import { Hero } from './Hero'
import { Closing } from './sections/Closing'
import { Floor } from './sections/Floor'
import { Interlude } from './sections/Interlude'
import { JobCost } from './sections/JobCost'
import { MachineDown } from './sections/MachineDown'
import { MoveIn } from './sections/MoveIn'
import { Plan } from './sections/Plan'
import { Quote } from './sections/Quote'
import { Schedule } from './sections/Schedule'
import { Ship } from './sections/Ship'
import { Slip } from './sections/Slip'
import { Trace } from './sections/Trace'
import '../styles/site.css'
import '../styles/landing.css'
import '../styles/cards.css'
import '../styles/schedule.css'
import '../styles/floor.css'

/**
 * run-larder.com's homepage, built from the design desk's approved page (17 Oct 2026, page-s1): one wholesale order,
 * SO-1184 for Hearth & Table, followed from quote to cash. Painted art appears only in the hero, the router drawing,
 * the interlude and the closing; every product card is HTML and CSS, and every figure agrees across sections.
 */
export function Landing() {
  return <>
    <Hero />
    <main id="main">
      <Quote />
      <Plan />
      <Slip />
      <Trace />
      <Schedule />
      <Floor />
      <MachineDown />
      <Interlude />
      <Ship />
      <JobCost />
      <MoveIn />
    </main>
    <Closing />
  </>
}

/** The schedule's ‹ › page the Gantt by three days where it scrolls (phones); the hint follows what is in view. */
export const landingScript = "document.querySelectorAll('[data-gantt]').forEach(b=>{b.hidden=false;b.addEventListener('click',()=>{const s=document.querySelector('.gantt-scroll'),d=s.querySelector('.day');s.scrollBy({left:(b.dataset.gantt==='next'?1:-1)*3*d.getBoundingClientRect().width,behavior:'smooth'})})})"
