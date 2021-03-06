/*
 * Copyright 2017 Simon Edwards <simon@simonzone.com>
 *
 * This source code is licensed under the MIT license which is detailed in the LICENSE.txt file.
 */

import {ThemeableElementBase} from '../ThemeableElementBase';
import * as ThemeTypes from '../Theme';
import * as DomUtils from '../DomUtils';
import {PopDownDialog} from './PopDownDialog';

const ID = "EtPopDownNumberDialogTemplate";
const ID_DIALOG = "ID_DIALOG";
const ID_INPUT = "ID_INPUT";

let registered = false;

/**
 * A Pop Down Number Dialog
 */
export class PopDownNumberDialog extends ThemeableElementBase {
  
  /**
   * The HTML tag name of this element.
   */
  static TAG_NAME = "ET-POPDOWNNUMBERDIALOG";

  /**
   * Initialize the PopDownNumberDialog class and resources.
   *
   * When PopDownNumberPicker is imported into a render process, this static method
   * must be called before an instances may be created. This is can be safely
   * called multiple times.
   */
  static init(): void {
    PopDownDialog.init();
    if (registered === false) {
      window.customElements.define(PopDownNumberDialog.TAG_NAME.toLowerCase(), PopDownNumberDialog);
      registered = true;
    }
  }

  // WARNING: Fields like this will not be initialised automatically.
  private _titlePrimary: string;

  private _titleSecondary: string;

  private _laterHandle: DomUtils.LaterHandle;

  private _extraCssFiles: ThemeTypes.CssFile[];

  private _initProperties(): void {
    this._titlePrimary = "";
    this._titleSecondary = "";
    this._laterHandle = null;
    this._extraCssFiles = [];
  }

  getValue(): number {
    const textInput = <HTMLInputElement> DomUtils.getShadowId(this, ID_INPUT);
    return textInput.valueAsNumber;
  }

  setValue(value: number): void {
    const textInput = <HTMLInputElement> DomUtils.getShadowId(this, ID_INPUT);
    textInput.valueAsNumber = value;
  }

  setMinimum(min: number): void {
    const textInput = <HTMLInputElement> DomUtils.getShadowId(this, ID_INPUT);
    textInput.setAttribute("min", "" + min);
  }

  setMaximum(max: number): void {
    const textInput = <HTMLInputElement> DomUtils.getShadowId(this, ID_INPUT);
    textInput.setAttribute("max", "" + max);
  }

  setTitlePrimary(text: string): void {
    this._titlePrimary = text;
    const dialog = <PopDownDialog> DomUtils.getShadowId(this, ID_DIALOG);
    if (dialog != null) {
      dialog.setTitlePrimary(text);
    }
  }

  getTitlePrimary(): string {
    return this._titlePrimary;
  }

  setTitleSecondary(text: string): void {
    this._titleSecondary = text;
    const dialog = <PopDownDialog> DomUtils.getShadowId(this, ID_DIALOG);
    if (dialog != null) {
      dialog.setTitleSecondary(text);
    }
  }

  getTitleSecondary(): string {
    return this._titleSecondary;
  }

  /**
   * Specify extra Css files to load into this element.
   * 
   * @param extraCssFiles extra Css files which should be loaded along side the default set.
   */
  addExtraCss(extraCssFiles: ThemeTypes.CssFile[]): void {
    this._extraCssFiles = [...this._extraCssFiles, ...extraCssFiles];
    this.updateThemeCss();
  }

  //-----------------------------------------------------------------------
  //
  //   #                                                         
  //   #       # ###### ######  ####  #   #  ####  #      ###### 
  //   #       # #      #      #    #  # #  #    # #      #      
  //   #       # #####  #####  #        #   #      #      #####  
  //   #       # #      #      #        #   #      #      #      
  //   #       # #      #      #    #   #   #    # #      #      
  //   ####### # #      ######  ####    #    ####  ###### ###### 
  //
  //-----------------------------------------------------------------------
  constructor() {
    super();
    this._initProperties(); // Initialise our properties. The constructor was not called.
    const shadow = this.attachShadow({ mode: 'open', delegatesFocus: true });
    const clone = this.createClone();
    shadow.appendChild(clone);
    this.updateThemeCss();

    const dialog = <PopDownDialog> DomUtils.getShadowId(this, ID_DIALOG);
    dialog.setTitlePrimary(this._titlePrimary);
    dialog.setTitleSecondary(this._titleSecondary);
    dialog.addEventListener(PopDownDialog.EVENT_CLOSE_REQUEST, () => {
      dialog.close();
    });

    const textInput = <HTMLInputElement> DomUtils.getShadowId(this, ID_INPUT);
    textInput.addEventListener('keydown', (ev: KeyboardEvent) => { this.handleKeyDown(ev); });
  }
  
  /**
   * 
   */
  private createClone(): Node {
    let template = <HTMLTemplateElement>window.document.getElementById(ID);
    if (template === null) {
      template = <HTMLTemplateElement>window.document.createElement('template');
      template.id = ID;
      template.innerHTML = `<style id="${ThemeableElementBase.ID_THEME}"></style>
        <${PopDownDialog.TAG_NAME} id="${ID_DIALOG}">
          <div class="form-group"><input type="number" id="${ID_INPUT}" min="0" max="10" class="form-control input-sm" value="1" /></div>
        </${PopDownDialog.TAG_NAME}>
        `;
      window.document.body.appendChild(template);
    }

    return window.document.importNode(template.content, true);
  }
  
  protected _themeCssFiles(): ThemeTypes.CssFile[] {
    return [ThemeTypes.CssFile.GUI_CONTROLS, ThemeTypes.CssFile.FONT_AWESOME, ...this._extraCssFiles];
  }

  //-----------------------------------------------------------------------
  /**
   * 
   */
  private handleKeyDown(ev: KeyboardEvent) {
    if (ev.key === "Escape") {
      this._okId(null);
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    
    if (ev.key === "Enter") {
      ev.preventDefault();
      ev.stopPropagation();
      
      const filterInput = <HTMLInputElement> DomUtils.getShadowId(this, ID_INPUT);
      this._okId(this.getValue());
    }
  }

  /**
   * 
   */
  open(x: number, y: number, width: number, height: number): void {
    const textInput = <HTMLInputElement> DomUtils.getShadowId(this, ID_INPUT);
    textInput.focus();

    const dialog = <PopDownDialog> DomUtils.getShadowId(this, ID_DIALOG);
    dialog.open(x, y, width, height);
  }

  /**
   * 
   */
  close(): void {
    const dialog = <PopDownDialog> DomUtils.getShadowId(this, ID_DIALOG);
    dialog.close();
  }

  private _okId(value: number): void {
    if (this._laterHandle === null) {
      this._laterHandle = DomUtils.doLater( () => {
        this.close();
        this._laterHandle = null;
        const event = new CustomEvent("selected", { detail: {value: value } });
        this.dispatchEvent(event);
      });
    }
  }
}
