import {
  type AnalysisPanelId,
  loadFrameworkLibrary,
  getActiveFrameworkForPanel,
  setActiveFrameworkForPanel,
} from '../services/analysis-framework-store';
import { t } from '../services/i18n';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';


interface FrameworkSelectorOptions {
  panelId: AnalysisPanelId;
  note?: string;
}

export class FrameworkSelector {
  readonly el: HTMLElement;
  private select: HTMLSelectElement;
  private panelId: AnalysisPanelId;
  private popup: HTMLElement | null = null;
  private btn: HTMLButtonElement;
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
  private note: string | undefined;

  constructor(opts: FrameworkSelectorOptions) {
    this.panelId = opts.panelId;
    this.note = opts.note;

    const btn = document.createElement('button');
    btn.className = 'icon-btn framework-settings-btn';
    setTrustedHtml(btn, trustedHtml('⚙', "legacy direct innerHTML migration"));
    this.btn = btn;

    const select = document.createElement('select');
    select.className = 'framework-popup-select';
    this.select = select;
    this.populateOptions(select);
    select.value = getActiveFrameworkForPanel(opts.panelId)?.id ?? '';
    select.addEventListener('change', () => {
      setActiveFrameworkForPanel(opts.panelId, select.value || null);
      this.updateBtnTitle();
      this.closePopup();
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.popup) {
        this.closePopup();
      } else {
        this.openPopup();
      }
    });

    this.updateBtnTitle();
    this.el = btn;
  }

  private updateBtnTitle(): void {
    const fw = getActiveFrameworkForPanel(this.panelId);
    this.btn.title = fw ? t('components.frameworkSelector.titlePrefix', { name: fw.name }) : t('components.frameworkSelector.titleNone');
  }

  private openPopup(): void {
    const btnRect = this.btn.getBoundingClientRect();

    const popup = document.createElement('div');
    popup.className = 'framework-settings-popup';
    popup.style.top = `${btnRect.bottom + 4}px`;
    popup.style.right = `${document.documentElement.clientWidth - btnRect.right}px`;

    const label = document.createElement('div');
    label.className = 'framework-settings-label';
    label.textContent = t('components.frameworkSelector.label');
    popup.appendChild(label);

    popup.appendChild(this.select);

    if (this.note) {
      const noteEl = document.createElement('div');
      noteEl.className = 'framework-settings-note';
      noteEl.textContent = this.note;
      popup.appendChild(noteEl);
    }

    document.body.appendChild(popup);
    this.popup = popup;
    this.btn.setAttribute('aria-expanded', 'true');

    const handler = (e: MouseEvent) => {
      if (!popup.contains(e.target as Node) && e.target !== this.btn) {
        this.closePopup();
      }
    };
    this.outsideClickHandler = handler;
    setTimeout(() => document.addEventListener('click', handler), 0);
  }

  private closePopup(): void {
    if (!this.popup) return;
    if (this.popup.contains(this.select)) {
      this.popup.removeChild(this.select);
    }
    this.popup.remove();
    this.popup = null;
    this.btn.setAttribute('aria-expanded', 'false');
    if (this.outsideClickHandler) {
      document.removeEventListener('click', this.outsideClickHandler);
      this.outsideClickHandler = null;
    }
  }

  private populateOptions(select: HTMLSelectElement): void {
    setTrustedHtml(select, trustedHtml('', "legacy direct innerHTML migration"));
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = t('components.frameworkSelector.defaultNeutral');
    select.appendChild(defaultOpt);

    for (const fw of loadFrameworkLibrary()) {
      const opt = document.createElement('option');
      opt.value = fw.id;
      opt.textContent = fw.name;
      select.appendChild(opt);
    }
  }

  refresh(): void {
    const current = this.select.value;
    this.populateOptions(this.select);
    this.select.value = getActiveFrameworkForPanel(this.panelId)?.id ?? current;
    this.updateBtnTitle();
  }

  destroy(): void {
    this.closePopup();
  }
}
