---
type: index
tags:
  - private
---
# 🔒 Propulsion – private HR values

```base
filters:
  and:
    - file.inFolder(this.file.folder)
    - type == "private-hr"
properties:
  note.person:
    displayName: Person
  note.salary_fixe:
    displayName: Salary (fixe)
  note.bonus:
    displayName: Bonus
  note.last_raise_date:
    displayName: Last raise
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
    name: Propulsion
    order:
      - person
      - salary_fixe
      - bonus
      - last_raise_date
      - experience_coeff
      - responsibility_role
      - responsibility_coeff
      - trend_salary
      - pct_of_trend
      - raise_to_95
      - raise_to_100
    sort:
      - property: person
        direction: ASC
    summaries:
      note.raise_to_95: Sum
      note.raise_to_100: Sum
```

[[00_Private/00_Index|← Private HR]]
