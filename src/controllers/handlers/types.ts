import { Permission } from '../../ports/access'
export type AccessBody = { permission: Permission; grantee: string }
