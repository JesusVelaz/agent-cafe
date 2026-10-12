'use client';

import Link from 'next/link';
import { Avatar } from '../Avatar';
import s from './landing.module.css';
import { DOWNSTAIRS, DownloadCta, Faces, Footer, Nav, OtherPlatforms, REPO, Tick, UPSTAIRS } from './SiteChrome';

const EARL = UPSTAIRS[0]!;
const MOCHA = DOWNSTAIRS[0]!;

/** agentscafe.dev: what Agents Café is, with the demo one click away at /demo. */
export function Landing() {
  return (
    <div className={s.page}>
      <Nav />

      <header className={s.hero}>
        <Faces agents={[...UPSTAIRS, ...DOWNSTAIRS]} />
        <h1>
          A control room for your coding agents, drawn as a <em>café</em>
        </h1>
        <p className={s.sub}>
          Run Claude Code and Codex side by side from one window, and see what every agent is doing at a glance. Bring your
          own subscription. Everything stays on your computer.
        </p>
        <div className={s.ctas}>
          <DownloadCta className={`${s.btn} ${s.light} ${s.big}`} />
          <Link className={`${s.btn} ${s.primary} ${s.big}`} href="/demo">
            Open the demo
          </Link>
        </div>
      </header>

      <div className={s.shot}>
        <Link className={s.frame} href="/demo" aria-label="Open the demo">
          {/* A static export serves images as they are, so a plain <img> with its size. */}
          <img
            src="/landing/cafe.png"
            width={2880}
            height={1800}
            alt="Agents Café: a two-storey pixel café with six agents at work, beside a work board of finished threads and a message box."
          />
        </Link>
      </div>

      <main className={s.wrap}>
        <section className={s.block}>
          <div className={`${s.head} ${s.center}`}>
            <h2>Runs on the plan you already pay for</h2>
            <p>
              Each floor runs the vendor&apos;s own coding agent, signed in with your Claude or ChatGPT subscription. No API
              keys to paste, no per-token bills, and Agents Café never sees or stores your credentials.
            </p>
          </div>
          <div className={s.floors}>
            <article className={`${s.floor} ${s.up}`}>
              <Faces agents={UPSTAIRS} scale={3} />
              <div>
                <h3>Claude Code</h3>
                <span className={s.where}>Upstairs, with your Claude plan</span>
              </div>
              <code className={s.command}>claude</code>
              <p>Press Connect in Settings and sign in once in Claude Code&apos;s own window. Pick any model your plan offers.</p>
            </article>
            <article className={`${s.floor} ${s.down}`}>
              <Faces agents={DOWNSTAIRS} scale={3} />
              <div>
                <h3>Codex</h3>
                <span className={s.where}>Ground floor, with your ChatGPT plan</span>
              </div>
              <code className={s.command}>codex login</code>
              <p>
                Agents Café pins Codex&apos;s sandbox, so edits stay in your project and nothing reaches the network unless
                you allow it.
              </p>
            </article>
          </div>
          <div className={s.notes}>
            <span>Both floors work at once</span>
            <span>Your plan&apos;s usage shows in the top bar</span>
            <span>Live runs count toward your normal limits</span>
          </div>
        </section>

        <section className={`${s.block} ${s.split}`}>
          <div className={s.head}>
            <h2>Nothing risky runs without your OK</h2>
            <p>
              When an agent wants to edit a file or run a command, it raises a hand in the café and an Allow / Deny card
              shows up on the work board.
            </p>
            <ul className={s.ticks}>
              <li>
                <Tick />
                <span>
                  <b>Ask first</b> by default, or auto-accept edits inside the project.
                </span>
              </li>
              <li>
                <Tick />
                <span>
                  <b>Always allow</b> remembers a command, file or URL for that project.
                </span>
              </li>
              <li>
                <Tick />
                <span>
                  <b>Needs you</b> lists every waiting approval in one place.
                </span>
              </li>
            </ul>
          </div>
          <div className={s.panel} role="img" aria-label="An approval card: Earl wants to run pnpm test, with Allow, Always allow and Deny.">
            <div className={s.bar}>
              <Avatar seed={EARL.seed} providerId={EARL.providerId} scale={2} />
              <b>Earl</b>
              <span className={s.task}>Fix the flaky orders test</span>
              <small>Ask first</small>
            </div>
            <div className={s.msgs}>
              <div className={s.step}>Read src/orders/queue.ts</div>
              <div className={s.step}>Edited src/orders/queue.ts (+12 −4)</div>
              <div className={s.approval}>
                <div className={s.question}>
                  <span className={`${s.bub} ${s.ask}`}>?</span>Earl wants to run a command
                </div>
                <pre>pnpm test --filter orders</pre>
                <div className={s.choices}>
                  <span className={s.allow}>Allow</span>
                  <span>Always allow</span>
                  <span>Deny</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={`${s.block} ${s.split} ${s.flip}`}>
          <div className={s.head}>
            <h2>Agents hand work to each other</h2>
            <p>
              Any agent can coordinate. It can message a teammate, delegate a task across floors, and pick up the result
              when it&apos;s done.
            </p>
            <ul className={s.ticks}>
              <li>
                <Tick />
                <span>
                  <b>Claude hands work to Codex</b> and back, each in its own conversation.
                </span>
              </li>
              <li>
                <Tick />
                <span>
                  <b>Results come home</b> to the thread that asked, even after a restart.
                </span>
              </li>
              <li>
                <Tick />
                <span>
                  <b>Built-in limits</b> stop runaway chains at 12 exchanges and 3 levels.
                </span>
              </li>
            </ul>
          </div>
          <div className={s.panel} role="img" aria-label="Earl's thread: he delegates a review to Mocha, and Mocha's result comes back.">
            <div className={s.bar}>
              <Avatar seed={EARL.seed} providerId={EARL.providerId} scale={2} />
              <b>Earl</b>
              <small>corner-cafe</small>
            </div>
            <div className={s.msgs}>
              <div className={`${s.bubble} ${s.mine}`}>
                Implement this fix, then get Mocha to do a read-only review. Tell me what changed.
              </div>
              <div className={s.step}>Edited src/menu/prices.ts</div>
              <div className={s.handoff}>
                <Avatar seed={MOCHA.seed} providerId={MOCHA.providerId} scale={2} />
                <span>
                  <b>Delegated to Mocha</b> · read-only review of src/menu <span className={`${s.tag} ${s.run}`}>WORKING</span>
                </span>
              </div>
              <div className={s.handoff}>
                <Avatar seed={MOCHA.seed} providerId={MOCHA.providerId} scale={2} />
                <span>
                  <b>Mocha&apos;s review came back</b> · 1 suggestion, applied <span className={`${s.tag} ${s.ok}`}>DONE</span>
                </span>
              </div>
              <div className={s.bubble}>
                Fixed the spring prices and added a test. Mocha flagged a rounding case, which I handled in prices.ts.
              </div>
            </div>
          </div>
        </section>

        <section className={s.block}>
          <div className={`${s.head} ${s.center}`}>
            <h2>Where they stand is what they&apos;re doing</h2>
            <p>
              A tool call walks an agent to that tool&apos;s station, and a bubble says the rest. You can tell who needs you
              without reading a single log.
            </p>
          </div>
          <div className={s.legend}>
            <div>
              <span className={s.bub}>...</span>
              <span>
                <b>Thinking</b>Seated, waiting on the model
              </span>
            </div>
            <div>
              <span className={s.bub}>
                <svg viewBox="0 0 6 6" shapeRendering="crispEdges" aria-hidden>
                  <path fill="currentColor" d="M0 0h6v1H5v1H4v2h1v1h1v1H0V5h1V4h1V2H1V1H0z" />
                </svg>
              </span>
              <span>
                <b>Using a tool</b>Bookcase reads, register runs
              </span>
            </div>
            <div>
              <span className={`${s.bub} ${s.ask}`}>?</span>
              <span>
                <b>Needs you</b>Waiting on Allow or Deny
              </span>
            </div>
            <div>
              <span className={`${s.bub} ${s.done}`}>
                <Tick />
              </span>
              <span>
                <b>Done</b>Just finished
              </span>
            </div>
            <div>
              <span className={`${s.bub} ${s.fail}`}>!</span>
              <span>
                <b>Failed</b>Retry from the work board
              </span>
            </div>
            <div>
              <span className={s.bub}>z</span>
              <span>
                <b>Quiet</b>No word for a minute
              </span>
            </div>
          </div>
        </section>

        <section className={`${s.block} ${s.split}`}>
          <div className={s.head}>
            <h2>Read the source, run it yourself</h2>
            <p>
              The whole café is on GitHub: a Next.js front end, a small local server, and a hand-drawn pixel renderer. Clone
              it and change anything.
            </p>
            <ul className={s.ticks}>
              <li>
                <Tick />
                <span>
                  <b>Local-first.</b> It listens on 127.0.0.1 unless you open it to your phone.
                </span>
              </li>
              <li>
                <Tick />
                <span>
                  <b>Your data</b> stays in ~/.agent-cafe.
                </span>
              </li>
              <li>
                <Tick />
                <span>
                  <b>Windows, macOS and Linux</b> builds on every release.
                </span>
              </li>
            </ul>
            <div>
              <a className={s.btn} href={REPO}>
                View on GitHub
              </a>
            </div>
          </div>
          <div className={s.term} role="img" aria-label="A terminal: clone the repository, pnpm install, pnpm dev, and the café opens on localhost:3000.">
            <span className={s.prompt}>$</span> <span className={s.cmd}>git clone {REPO}</span>
            {'\n'}
            <span className={s.prompt}>$</span> <span className={s.cmd}>pnpm install</span>
            {'\n'}
            <span className={s.yes}>✓</span> dependencies installed{'\n'}
            <span className={s.prompt}>$</span> <span className={s.cmd}>pnpm dev</span>
            {'\n'}
            <span className={s.yes}>✓</span> server on 127.0.0.1:4318{'\n'}
            <span className={s.yes}>✓</span> café open on <span className={s.url}>localhost:3000</span>
            {'\n'}
            <span className={s.yes}>✓</span> seeded Mocha, Chai, Biscotti, Earl, Matcha, Scone
          </div>
        </section>
      </main>

      <section className={s.final}>
        <Faces agents={[...UPSTAIRS, ...DOWNSTAIRS]} scale={3} />
        <h2>Give your agents a nicer place to work</h2>
        <p>Agents Café is free to download and runs on Windows, macOS and Linux.</p>
        <div className={s.ctas}>
          <DownloadCta className={`${s.btn} ${s.light}`} />
          <OtherPlatforms className={s.btn} />
        </div>
      </section>

      <Footer>
        <a href={REPO}>GitHub</a>
        <Link href="/download">Download</Link>
      </Footer>
    </div>
  );
}
