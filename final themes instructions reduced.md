# Dashboard Design System & Data Visualization — Coding Agent Prompt

Rework the dashboard visual system around a **clean, premium, data-first aesthetic**. The interface should feel technical and elegant rather than overly decorative.

The design system must support **four themes**:

1. Dark — Metal / Minimal
2. Dark — Warm / Fancy
3. Light — Metal / Minimal
4. Light — Warm / Fancy

The data visualization system must remain **semantically consistent across all themes**.

---

## 1. Typography

Use **Inter** as the primary typeface throughout the application.

Do not introduce multiple font families.

Keep the typography system deliberately small, with **no more than 6 font sizes**:

| Token     | Size |  Weight | Usage                              |
| --------- | ---: | ------: | ---------------------------------- |
| `display` | 22px |     600 | Page titles, hero values           |
| `heading` | 18px |     600 | Section/card titles                |
| `body`    | 15px |     400 | Normal text and descriptions       |
| `data`    | 16px |     600 | KPI values and important numbers   |
| `label`   | 13px |     500 | Labels, controls, legends          |
| `meta`    | 11px | 400–500 | Secondary information, comparisons |

Do not introduce additional font sizes unless strictly necessary.

Use weight and spacing rather than additional font sizes to create hierarchy.

Avoid text smaller than 11px.

---

# 2. Theme System

Create four visual themes using the same structural design system.

The themes should change the **UI chrome**, but should NOT change the semantic meaning of data visualization colors.

---

## 2.1 Dark — Metal / Minimal

This should be the primary/default dark theme.

The visual language should be:

* cold
* technical
* refined
* metallic
* minimal
* high contrast without being harsh

```text
Background   #0B1220
Card         #121A2B
Surface      #1A2433
Border       #2A3B4D
Text         #E6EDF3
Muted        #9AA4B2
Accent       #3B82F6
Success      #22C55E
Danger       #EF4444
```

Do not make the entire interface blue.

Blue should primarily function as an accent and data color.

---

## 2.2 Dark — Warm / Fancy

Create a warmer and slightly more expressive alternative.

The visual language should be:

* premium
* warm
* sophisticated
* slightly more decorative
* still professional

```text
Background   #0F141A
Card         #1A1F26
Surface      #22272E
Border       #2F353D
Text         #F5EDE3
Muted        #8B8A6A
Accent       #F59E0B
Success      #22C55E
Danger       #EF4444
```

Use amber/gold selectively for selected states, highlights and important controls.

Do not turn the interface entirely orange.

---

## 2.3 Light — Metal / Minimal

This is the preferred light counterpart to the Dark Metal theme.

Do NOT use pure white as the page background.

Use a very subtle cold blue-grey background to create a soft metallic appearance.

```text
Background   #F7F9FB
Card         #FFFFFF
Surface      #F0F4F8
Border       #D1D9E2
Text         #111827
Muted        #6B7280
Accent       #2563EB
Success      #16A34A
Danger       #DC2626
```

Cards may remain white, but the overall page must not feel like a pure white canvas.

---

## 2.4 Light — Warm / Fancy

Use a warm off-white background rather than pure white.

```text
Background   #FAF7F2
Card         #FFFFFF
Surface      #FBF8F2
Border       #E5E3DB
Text         #1F2937
Muted        #6B7280
Accent       #F59E0B
Success      #22C55E
Danger       #D14343
```

The warmth should come from the background, surfaces, borders and accents.

Do not make the body text beige.

---

# 3. Data Visualization Color System

This is critical:

**Do not change the semantic color system when switching themes.**

The UI theme can change, but users must always understand data in the same way.

Use the following semantic rules consistently.

---

# 4. Pace Visualization

Pace is the most important special case.

Garmin users commonly understand:

> **Blue = faster pace**

Preserve this mental model.

Do NOT reverse the scale to make red = fast.

However, do NOT copy Garmin's exact palette.

Create a distinctive **metallic pace gradient**.

## Pace direction

```text
FAST → SLOW

Steel Blue
     ↓
Blue / Teal Steel
     ↓
Oxidized Metal
     ↓
Muted Brass
     ↓
Copper
```

Recommended base palette:

```text
FAST
#4A8FC7
#5E9EAD
#7F9C96
#A79572
#B87855
SLOW
```

The gradient should feel:

* metallic
* technical
* sophisticated
* slightly desaturated
* clearly different from Garmin's branding

Do NOT use a conventional rainbow gradient.

Do NOT use green as a central pace color because green can be interpreted as "good/success".

Do NOT use red as the slowest pace because red is reserved primarily for heart rate and warnings.

### Pace semantic rule

> **Blue always represents faster pace. Progressively warmer metallic tones represent slower pace.**

This rule must remain identical across all four themes.

---

# 5. Single-Activity Pace Graph

For a single activity, the pace line must be **data-driven and continuously gradient-colored**.

Do not render the entire line as one color.

Each segment of the line should receive a color based on the pace value at that point.

Conceptually:

```text
FAST

🔵
  🔵
    🩵
       🩶
          🟤
             🟠

SLOW
```

The gradient must correspond to the actual pace values.

Do not use the gradient merely as decoration.

Use a stable normalization strategy where possible so that the same pace values produce comparable colors across activities.

Always show the actual pace value in the tooltip.

Example:

```text
5:12 /km
Fast pace
```

Do not force the user to infer the exact value from color.

---

# 6. Pace Legend

Add a compact legend directly above the graph:

```text
PACE

FAST  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  SLOW
      blue        metal        copper
```

Explicitly label the direction as:

**FAST → SLOW**

Do not rely exclusively on color to communicate the meaning.

---

# 7. Heart Rate Visualization

Keep the familiar convention:

> **Pink = lower heart rate → Red = higher heart rate**

Do NOT invent a completely new color system for heart rate.

The familiarity is valuable and users should immediately understand it.

Use a refined pink-to-red gradient:

```text
LOW → HIGH

#D98BA5
    ↓
#D96B83
    ↓
#D94F63
    ↓
#D83B4B
    ↓
#C92F3D
```

The result should visually read as:

```text
Pink → Rose → Coral → Red → Deep Red
```

Keep it slightly sophisticated/desaturated rather than using generic bright web colors.

---

# 8. Heart Rate vs UI Danger Color

Do not use exactly the same red for heart rate and system errors.

Heart rate should have its own dedicated red scale.

For example:

```text
Heart Rate High
#D94F63

UI Danger/Error
#EF4444
```

They can be visually related but must remain distinguishable.

This prevents a high-HR section of the graph from looking like an application error state.

---

# 9. Pace vs Heart Rate Hierarchy

When pace and heart rate appear together:

### Pace

* Primary visualization
* Full saturation
* 2–3px line
* Continuous metallic gradient
* Stronger visual presence

### Heart Rate

* Secondary visualization
* 2px line
* Pink → red gradient
* Slightly reduced visual weight when both are displayed

### Activity/background

* Muted steel/grey
* Very low opacity
* Must never compete with pace

The hierarchy should communicate:

> **Pace = primary performance signal**
> **Heart rate = physiological context**

---

# 10. Comparison Graph

When comparing current vs previous periods:

### Current period

Use the full semantic gradient.

### Previous period

Use:

* Same underlying gradient
* Dashed line
* Approximately 35–45% opacity
* Reduced visual weight

This allows users to understand:

```text
Current = primary
Previous = contextual reference
```

Do not use two fully saturated gradients simultaneously.

---

# 11. Other Data Colors

Use these semantic conventions:

| Data                | Visual treatment              |
| ------------------- | ----------------------------- |
| Pace                | Blue/metallic → warm gradient |
| Heart rate          | Pink → red gradient           |
| Distance            | Blue / primary accent         |
| Activity/background | Muted steel/grey              |
| Current period      | Solid                         |
| Previous period     | Dashed + reduced opacity      |
| Positive change     | Green                         |
| Negative change     | Red                           |

Avoid using green inside the pace gradient.

---


# 12. Icon System

Introduce the icons used in the overview tab consistently across the dashboard. Keep consistency on 
* stroke width
* size
* corner style
* visual weight

Use one coherent icon family with consistent:

* stroke width
* size
* corner style
* visual weight
---



# 18. Spacing

Use a consistent spacing system throughout the application.

Avoid:

* large unexplained gaps
* inconsistent card padding
* excessive separation between graph elements
* tightly packed unrelated components

The dashboard should feel like **one coherent analytical interface**, rather than a collection of independent cards.

---


# 20. Overall Design Principle

The final design should balance:

**Familiar semantics + distinctive visual identity.**

Do not reinvent universally understood meanings merely to make the interface look different.

Specifically:

* **Pace:** blue = faster, using a unique metallic blue → warm gradient.
* **Heart rate:** pink = lower, red = higher.
* **Success:** green.
* **Danger/error:** red, but distinct from HR red.
* **Neutral data:** steel/grey.

The product should feel **premium, technical, elegant and data-focused**, while remaining immediately understandable to users familiar with Garmin-style fitness analytics.
