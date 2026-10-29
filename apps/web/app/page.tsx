import Link from 'next/link';
import {
  ArrowDownLeft,
  ArrowRight,
  Boxes,
  Braces,
  GitBranch,
  Layers3,
  MousePointer2,
  Radar,
  Sparkles,
  Waypoints,
} from 'lucide-react';
import { Brand } from '@/components/brand';
import { RepositoryForm } from '@/components/repository-form';
import { Badge, Card } from '@/components/ui';

const features = [
  {
    icon: Boxes,
    number: '01',
    title: 'Architecture Map',
    text: 'See the shape of a codebase, from its entry points to the modules that connect it.',
  },
  {
    icon: Waypoints,
    number: '02',
    title: 'UI Flow Map',
    text: 'Follow the paths through an interface and understand how experiences fit together.',
  },
  {
    icon: Radar,
    number: '03',
    title: 'Impact Analysis',
    text: 'Trace the connections around a change before you make your next move.',
  },
  {
    icon: Sparkles,
    number: '04',
    title: 'Learning Mode',
    text: 'Build context at your own pace, one meaningful discovery at a time.',
  },
];
function Preview() {
  return (
    <div className="preview" aria-label="Illustrative architecture map concept">
      <div className="preview-top">
        <div className="window-dots">
          <i />
          <i />
          <i />
        </div>
        <span>architecture.map</span>
        <span className="preview-label">
          <span className="status-dot" /> CONCEPT PREVIEW
        </span>
      </div>
      <div className="preview-body">
        <div className="preview-sidebar">
          <span>EXPLORER</span>
          <div className="preview-line active" />
          <div className="preview-line" />
          <div className="preview-line short" />
          <div className="preview-line" />
          <div className="preview-line short" />
        </div>
        <div className="preview-canvas">
          <div className="canvas-caption">
            SYSTEM OVERVIEW <span> / CONCEPT</span>
          </div>
          <svg
            className="preview-lines"
            viewBox="0 0 600 300"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d="M 126 150 C 220 150, 220 78, 300 78 M 126 150 C 220 150, 220 220, 300 220 M 300 78 C 385 78, 390 150, 485 150 M 300 220 C 385 220, 390 150, 485 150" />
          </svg>
          <div className="map-node node-one">
            <span className="node-icon blue">
              <Braces size={16} />
            </span>
            <div>
              <b>entry point</b>
              <small>application</small>
            </div>
          </div>
          <div className="map-node node-two">
            <span className="node-icon violet">
              <Layers3 size={16} />
            </span>
            <div>
              <b>modules</b>
              <small>structure</small>
            </div>
          </div>
          <div className="map-node node-three">
            <span className="node-icon teal">
              <GitBranch size={16} />
            </span>
            <div>
              <b>connections</b>
              <small>dependencies</small>
            </div>
          </div>
          <div className="map-node node-four">
            <span className="node-icon blue">
              <Boxes size={16} />
            </span>
            <div>
              <b>codebase</b>
              <small>understanding</small>
            </div>
          </div>
          <div className="preview-hint">
            <MousePointer2 size={12} /> A clearer view of your code
          </div>
        </div>
      </div>
    </div>
  );
}
export default function Home() {
  return (
    <main className="landing">
      <header className="site-header">
        <div className="site-width header-inner">
          <Brand />
          <nav aria-label="Main navigation">
            <a href="#features">The platform</a>
            <a href="#how-it-works">How it works</a>
            <Link href="/explorer" className="nav-cta">
              Open explorer <ArrowRight size={15} />
            </Link>
          </nav>
        </div>
      </header>
      <section className="hero site-width">
        <div className="hero-glow" />
        <div className="hero-copy">
          <Badge className="eyebrow">
            <span className="status-dot" /> A NEW WAY TO READ CODE
          </Badge>
          <h1>
            Find your way
            <br />
            <span>through the code.</span>
          </h1>
          <p className="hero-lede">
            The context you need to understand any codebase. See the
            architecture, follow the connections, and make your next move with
            confidence.
          </p>
          <RepositoryForm />
          <div className="hero-secondary">
            <Link href="/explorer">
              Explore the example <ArrowRight size={15} />
            </Link>
            <span>NO SETUP REQUIRED</span>
          </div>
        </div>
        <Preview />
        <div className="hero-bottom">
          <span>BUILT FOR CURIOSITY. DESIGNED FOR CLARITY.</span>
          <a href="#features">
            SCROLL TO EXPLORE <ArrowDownLeft size={14} />
          </a>
        </div>
      </section>
      <section className="features site-width" id="features">
        <div className="section-heading">
          <div>
            <span className="section-kicker">THE BIG PICTURE, AT LAST</span>
            <h2>
              Less searching.
              <br />
              <span>More understanding.</span>
            </h2>
          </div>
          <p>
            Every codebase has a story. CodeDNA helps you see how the pieces fit
            together, without getting lost in the details.
          </p>
        </div>
        <div className="feature-grid">
          {features.map(({ icon: Icon, number, title, text }) => (
            <Card className="feature-card" key={title}>
              <div className="feature-card-top">
                <span className="feature-icon">
                  <Icon size={20} />
                </span>
                <span>{number} / 04</span>
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
              <span className="feature-coming">
                ON THE ROADMAP <ArrowRight size={13} />
              </span>
            </Card>
          ))}
        </div>
      </section>
      <section className="closing site-width" id="how-it-works">
        <div>
          <span className="section-kicker">START WITH CONTEXT</span>
          <h2>
            Curiosity is your
            <br />
            <span>best starting point.</span>
          </h2>
          <p>
            Get a feel for the workspace with a bundled example, or explore a
            public GitHub repository.
          </p>
          <Link className="button button--primary" href="/explorer">
            Explore the example <ArrowRight size={16} />
          </Link>
        </div>
        <div className="closing-art" aria-hidden="true">
          <div className="closing-ring ring-one" />
          <div className="closing-ring ring-two" />
          <div className="closing-core">
            <Brand />
          </div>
        </div>
      </section>
      <footer className="site-width site-footer">
        <Brand />
        <span>MADE FOR THE CODE-CURIOUS.</span>
        <span>
          OPEN SOURCE FIRST <span className="status-dot" />
        </span>
      </footer>
    </main>
  );
}
