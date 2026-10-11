/**
 * ImageSlider: a dependency-free, infinitely looping image slider.
 *
 * LAYOUT MATH
 * The track is a flex row; every slide is exactly 100% of the viewport wide.
 * The track itself is only one viewport wide, so translateX(-100%) moves
 * exactly ONE slide at any screen size. No pixel maths, nothing to recalculate
 * on resize.
 *
 * INFINITE LOOP
 * Two clones are added to the track:
 *
 *   [ clone of LAST ] [ 1 ] [ 2 ] [ 3 ] [ 4 ] [ clone of FIRST ]
 *     position 0        1     2     3     4       position 5
 *
 * "Next" on the last slide keeps sliding left onto the clone of slide 1. When
 * that animation ends, the track is moved back to the real slide 1 with the
 * transition switched off. Clone and original look identical, so the jump is
 * invisible. "Previous" on the first slide works the same way in reverse.
 *
 *   this.index    : real slide index, 0 .. count-1 (drives dots + badge)
 *   this.position : track slot, 0 .. count+1       (drives translateX)
 */
class ImageSlider {
  constructor(root, options = {}) {
    this.root = typeof root === 'string' ? document.querySelector(root) : root;
    if (!this.root) throw new Error('ImageSlider: root element not found.');

    this.options = { startIndex: 0, keyboard: true, swipe: true, ...options };

    this.track = this.root.querySelector('.slider__track');
    if (!this.track) throw new Error('ImageSlider: ".slider__track" not found.');

    this.slides = Array.from(this.track.children);
    this.count = this.slides.length;
    this.index = 0;
    this.position = 0;
    this.isAnimating = false;
    this.finishTimer = null;
    this.swipeStartX = null;

    this.onTransitionEnd = this.onTransitionEnd.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);

    this.init();
  }

  /* ---------- Setup ---------- */

  init() {
    if (this.count === 0) return;

    this.isLoopable = this.count > 1;

    if (this.isLoopable) {
      this.createClones();
      this.createArrows();
      this.createDots();
      this.createCounter();
      this.bindEvents();
    }

    const start = Math.min(Math.max(this.options.startIndex, 0), this.count - 1);
    this.index = start;
    this.position = this.isLoopable ? start + 1 : 0;
    this.render({ animate: false });
  }

  createClones() {
    const firstClone = this.slides[0].cloneNode(true);
    const lastClone = this.slides[this.count - 1].cloneNode(true);

    [firstClone, lastClone].forEach((clone) => {
      clone.setAttribute('aria-hidden', 'true');
      clone.dataset.clone = 'true';
    });

    this.track.append(firstClone);
    this.track.prepend(lastClone);
  }

  createArrows() {
    const icon = (points) =>
      `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><polyline points="${points}"/></svg>`;

    this.prevBtn = this.createButton('slider__arrow slider__arrow--prev', 'Previous slide', icon('15 5 8 12 15 19'));
    this.nextBtn = this.createButton('slider__arrow slider__arrow--next', 'Next slide', icon('9 5 16 12 9 19'));

    this.root.append(this.prevBtn, this.nextBtn);
  }

  createDots() {
    this.dotsWrap = document.createElement('div');
    this.dotsWrap.className = 'slider__dots';

    this.dots = this.slides.map((_, i) => {
      const dot = this.createButton('slider__dot', `Go to slide ${i + 1} of ${this.count}`);
      dot.dataset.index = String(i);
      this.dotsWrap.append(dot);
      return dot;
    });

    this.root.append(this.dotsWrap);
  }

  createCounter() {
    this.counter = document.createElement('div');
    this.counter.className = 'slider__counter';
    this.counter.setAttribute('aria-live', 'polite');
    this.root.append(this.counter);
  }

  createButton(className, label, html = '') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = html;
    return btn;
  }

  bindEvents() {
    this.prevBtn.addEventListener('click', () => this.prev());
    this.nextBtn.addEventListener('click', () => this.next());

    this.dotsWrap.addEventListener('click', (event) => {
      const dot = event.target.closest('.slider__dot');
      if (dot) this.goTo(Number(dot.dataset.index));
    });

    this.track.addEventListener('transitionend', this.onTransitionEnd);

    if (this.options.keyboard) {
      this.root.tabIndex = 0;
      this.root.addEventListener('keydown', this.onKeyDown);
    }

    if (this.options.swipe) {
      this.root.addEventListener('pointerdown', this.onPointerDown);
      this.root.addEventListener('pointerup', this.onPointerUp);
      this.root.addEventListener('pointercancel', () => { this.swipeStartX = null; });
    }
  }

  /* ---------- Public API ---------- */

  next() {
    if (!this.isLoopable || this.isAnimating) return;
    this.position += 1;
    this.index = (this.index + 1) % this.count;
    this.render({ animate: true });
  }

  prev() {
    if (!this.isLoopable || this.isAnimating) return;
    this.position -= 1;
    this.index = (this.index - 1 + this.count) % this.count;
    this.render({ animate: true });
  }

  goTo(target) {
    if (!this.isLoopable || this.isAnimating) return;
    if (!Number.isInteger(target) || target < 0 || target >= this.count) return;
    if (target === this.index) return;

    this.index = target;
    this.position = target + 1;
    this.render({ animate: true });
  }

  destroy() {
    clearTimeout(this.finishTimer);
    this.track.removeEventListener('transitionend', this.onTransitionEnd);
    this.root.removeEventListener('keydown', this.onKeyDown);
    this.root.removeEventListener('pointerdown', this.onPointerDown);
    this.root.removeEventListener('pointerup', this.onPointerUp);
    this.root.querySelectorAll('[data-clone]').forEach((el) => el.remove());
    [this.prevBtn, this.nextBtn, this.dotsWrap, this.counter].forEach((el) => el && el.remove());
    this.track.style.transform = '';
    this.track.style.transition = '';
  }

  /* ---------- Rendering ---------- */

  render({ animate }) {
    if (!animate) {
      this.setTransform(false);
      this.updateUI();
      return;
    }

    const duration = this.getTransitionDuration();
    this.updateUI();

    if (duration === 0) {                  // reduced motion: jump instantly
      this.setTransform(false);
      this.finishMove();
      return;
    }

    this.isAnimating = true;
    this.setTransform(true);

    // Safety net in case `transitionend` never fires.
    clearTimeout(this.finishTimer);
    this.finishTimer = setTimeout(() => this.finishMove(), duration + 100);
  }

  setTransform(animate) {
    if (!animate) this.track.style.transition = 'none';
    this.track.style.transform = `translateX(${-this.position * 100}%)`;

    if (!animate) {
      void this.track.offsetWidth;         // force reflow so "none" applies first
      this.track.style.transition = '';    // hand control back to style.css
    }
  }

  updateUI() {
    if (this.counter) this.counter.textContent = `Image ${this.index + 1} of ${this.count}`;
    if (!this.dots) return;

    this.dots.forEach((dot, i) => {
      const active = i === this.index;
      dot.classList.toggle('slider__dot--active', active);
      if (active) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
  }

  /* ---------- Loop handling ---------- */

  onTransitionEnd(event) {
    if (event.target !== this.track || event.propertyName !== 'transform') return;
    this.finishMove();
  }

  finishMove() {
    if (!this.isAnimating && !this.isOnClone()) return;
    clearTimeout(this.finishTimer);

    if (this.position === this.count + 1) this.position = 1;       // trailing clone -> real first
    else if (this.position === 0) this.position = this.count;     // leading clone  -> real last

    this.setTransform(false);              // invisible jump
    this.isAnimating = false;
  }

  isOnClone() {
    return this.position === 0 || this.position === this.count + 1;
  }

  getTransitionDuration() {
    const first = getComputedStyle(this.track).transitionDuration.split(',')[0].trim();
    const value = parseFloat(first) || 0;
    return first.endsWith('ms') ? value : value * 1000;
  }

  /* ---------- Keyboard and swipe ---------- */

  onKeyDown(event) {
    if (event.key === 'ArrowRight') { event.preventDefault(); this.next(); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); this.prev(); }
  }

  onPointerDown(event) {
    if (event.target.closest('button')) return;
    this.swipeStartX = event.clientX;
  }

  onPointerUp(event) {
    if (this.swipeStartX === null) return;
    const deltaX = event.clientX - this.swipeStartX;
    this.swipeStartX = null;

    const threshold = 50;
    if (deltaX <= -threshold) this.next();
    else if (deltaX >= threshold) this.prev();
  }
}

/* Auto-initialise every element with data-slider. */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-slider]').forEach((el) => new ImageSlider(el));
});

window.ImageSlider = ImageSlider;