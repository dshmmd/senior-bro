// Admin · Overview (RF-9 slice 2): the console home — one card per section.
import { useNavigate } from 'react-router'
import { NavCard } from '../../components/Card'
import { AdminShell } from './AdminShell'

export function AdminOverview() {
  const navigate = useNavigate()
  const go = (to: string) => () => void navigate(to)
  return (
    <AdminShell title="Overview">
      <p className="sub">
        Everything here takes effect live — no redeploy. Every action is recorded in the admin log.
      </p>
      <NavCard
        title="Models & keys"
        hint="Curate provided models, rotate API keys, set per-Mtok prices and the global default."
        onClick={go('/admin/models')}
      />
      <NavCard
        title="Feature routing & kill switches"
        hint="Pick which model powers each feature; disable a misbehaving feature instantly."
        onClick={go('/admin/features')}
      />
      <NavCard
        title="System prompts"
        hint="Edit, version, compare and roll back the prompts that drive the product."
        onClick={go('/admin/prompts')}
      />
      <NavCard
        title="Company packs"
        hint="Review, edit, regenerate or retire the generated interview playbooks."
        onClick={go('/admin/packs')}
      />
      <NavCard
        title="Users"
        hint="Usage & cost per user, token quotas, suspension."
        onClick={go('/admin/users')}
      />
      <NavCard
        title="Invites"
        hint="Mint single-use token-credit codes for testers and partners."
        onClick={go('/admin/invites')}
      />
      <NavCard
        title="Usage audit"
        hint="Every metered model call: who, when, which model, tokens, cost. CSV export."
        onClick={go('/admin/usage')}
      />
      <NavCard
        title="Admin log"
        hint="The audit trail of admin actions on this deploy."
        onClick={go('/admin/audit')}
      />
    </AdminShell>
  )
}
