settings button template

current shared button class used in the desktop app:

```tsx
<button className="settings-form__button" type="button">
  settings
</button>
```

primary variant:

```tsx
<button className="settings-form__button settings-form__button--primary" type="button">
  save
</button>
```

exact css from `apps/desktop/src/renderer/src/assets/main.css`:

```css
.settings-form__button {
  border: 1px solid #d8d8d8;
  background: #f3f3f3;
  color: #111111;
  cursor: pointer;
  padding: 7px 12px;
  border-radius: 8px;
}

.settings-form__button--primary {
  border-color: #111111;
  background: #111111;
  color: #ffffff;
}

.settings-form__button:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}
```

use this class for small plain action buttons that should match the current desktop settings button.
