
```base
filters:
  and:
    - file.inFolder(this.file.folder)
    - type == "person"
properties:
  file.name:
    displayName: Person
  note.role:
    displayName: Role
  note.position:
    displayName: Job description
  note.contract:
    displayName: Contract
  note.status:
    displayName: Status
  note.hiring_status:
    displayName: Hiring status
views:
  - type: table
    name: Team
    order:
      - file.name
      - role
      - position
      - contract
      - status
      - hiring_status
    sort:
      - property: file.name
        direction: ASC
```
