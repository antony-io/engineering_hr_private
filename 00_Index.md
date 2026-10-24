---
type: index
cssclasses:
  - wide-page
tags:
  - private
---
# 🔒 Private HR values

## Salary dashboard
```salary-dashboard
```
[[Salary dashboard.html|Open the last generated dashboard]] (opens in your browser). The button above regenerates it from the private notes and updates the *Trend / % of trend / Raise → 95 % / 100 %* columns of the tables (also: ribbon icon or command palette → *Generate salary dashboard*). Changes made in the dashboard are exported with *📝 Write changes (.md)*: apply them to the private notes.


## Teams
Private notes are filed by team, same folders as `10_Public` and `20_Positions`. The table at the bottom lists everybody.
- [[00_Private/01_Satellite architecture/00_Index|Satellite architecture]]
- [[00_Private/02_SE_Modeling_and_Simulation/00_Index|SE Modeling & Simulation]]
- [[00_Private/03_System_Engineering_Design/00_Index|SE Design]]
- [[00_Private/04_E2E_V&V/00_Index|E2E V&V]]
- [[00_Private/05_Propulsion/00_Index|Propulsion]]
- [[00_Private/06_Structure_Architecture/00_Index|Structure Architecture]]
- [[00_Private/07_Mech_Thermal_CoC/00_Index|Mech & Thermal CoC]]
- [[00_Private/08_Electrical_Power_RF/00_Index|Electrical Power RF]]
- [[00_Private/09_Robotics_Mechanisms/00_Index|Robotics & Mechanisms]]

## Coefficients
Pre-filled on 09/10/2026 from the HR sheet (professional experience) with the default scales below — edit any value by hand. *Responsibility coeff* follows the role × level grid below.

| Experience (years) | 0–1 | 2–3 | 4–6 | 7–10 | 11–15 | 16+ |
|---|---|---|---|---|---|---|
| **Experience coeff** | 1.00 | 1.10 | 1.20 | 1.30 | 1.40 | 1.50 |

**Responsibility coeff**: role × level (grid validated 13/10/2026).

| Role                                                                                                                                              | To Develop | Standard Potential | High Potential |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------ | -------------- |
| **Engineer**: owns deliverables on a subsystem or work package                                                                                    | 1.00       | 1.20               | 1.40           |
| **Architect**: owns the design and technical choices of a domain, sets the interfaces                                                             | 1.30       | 1.40               | 1.50           |
| **Team lead** or **Expert**:<br>- manages a team (people, hiring, workload, competences)<br>- is a technical reference and guidance for the teams | 1.40       | 1.60               | 1.80           |
find . -name \* -print -exec grep level {}
Rules:
- **Combined role** (team lead + architect, team lead + project technical lead): **+0.05**.
- **Project technical lead** without a team: architect of the same level **+0.05**.
- **Interns**: 1.00. **Open positions**: level targeted (mid by default).
- Notes with `responsibility_review` have a level deduced from experience (0–2 y junior, 3–6 mid, 7+ senior) or a remapped role: check them, then delete the field.
- Salary coeff (dashboard) = experience coeff × responsibility coeff, from **1.00** (junior engineer, 0–1 y) to **2.78** (senior team lead + combined role, 16+ y: 1.50 × 1.85).


## Table
Full-screen version (3 views: *All people*, *Below trend*, *By team*): **[[Private HR.base|Open Private HR.base]]**.

```base
filters:
  and:
    - file.inFolder("00_Private")
    - type == "private-hr"
formulas:
  team: file.folder.replace("00_Private/", "")
properties:
  note.person:
    displayName: Person
  formula.team:
    displayName: Team
  note.job_title:
    displayName: Job title
  note.experience_years:
    displayName: Experience (y)
  note.seniority_date:
    displayName: Seniority date
  note.last_raise_date:
    displayName: Last raise
  note.salary_fixe:
    displayName: Salary (fixe)
  note.bonus:
    displayName: Bonus
  note.experience_coeff:
    displayName: Experience coeff
  note.responsibility_role:
    displayName: Responsibility role
  note.responsibility_coeff:
    displayName: Responsibility coeff
  note.trend_salary:
    displayName: Trend (avg. same coeff)
  note.pct_of_trend:
    displayName: "% of trend"
  note.raise_to_95:
    displayName: Raise → 95 %
  note.raise_to_100:
    displayName: Raise → 100 %
views:
  - type: table
    name: All people
    order:
      - person
      - formula.team
      - job_title
      - trend_salary
      - experience_years
      - seniority_date
      - last_raise_date
      - salary_fixe
      - bonus
      - experience_coeff
      - responsibility_role
      - responsibility_coeff
      - pct_of_trend
      - raise_to_95
      - raise_to_100
    sort:
      - property: formula.team
        direction: ASC
      - property: person
        direction: ASC
    summaries:
      salary_fixe: Sum
      bonus: Sum
      raise_to_95: Sum
      raise_to_100: Sum
  - type: table
    name: Below trend
    filters:
      and:
        - pct_of_trend < 100
    order:
      - person
      - formula.team
      - responsibility_role
      - salary_fixe
      - trend_salary
      - pct_of_trend
      - raise_to_95
      - raise_to_100
      - last_raise_date
    sort:
      - property: pct_of_trend
        direction: ASC
    summaries:
      raise_to_95: Sum
      raise_to_100: Sum
  - type: table
    name: By team
    groupBy:
      property: formula.team
      direction: ASC
    order:
      - person
      - job_title
      - salary_fixe
      - bonus
      - responsibility_role
      - pct_of_trend
      - raise_to_95
      - raise_to_100
    sort:
      - property: person
        direction: ASC
    summaries:
      salary_fixe: Sum
      raise_to_95: Sum
      raise_to_100: Sum

```
