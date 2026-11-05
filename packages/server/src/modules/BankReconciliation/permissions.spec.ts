import { Ability } from '@casl/ability';
import { AbilitySchema } from '../Roles/AbilitySchema';
import { getSuperAdminRules } from '../Roles/TenantAbilities';
import { CashflowAction } from '../BankingTransactions/types/BankingTransactions.types';
import { AbilitySubject } from '../Roles/Roles.types';
import { events } from '@/common/events/events';

describe('BankReconciliation permissions', () => {
  it('defines the reconcile ability keys', () => {
    expect(CashflowAction.Reconcile).toBe('Reconcile');
    expect(CashflowAction.UndoReconciliation).toBe('UndoReconciliation');
  });

  it('lists both keys in the Cashflow block of the ability schema', () => {
    const block = AbilitySchema.find(
      (s) => s.subject === AbilitySubject.Cashflow,
    );
    const keys = block.abilities.map((a) => a.key);

    expect(keys).toContain(CashflowAction.Reconcile);
    expect(keys).toContain(CashflowAction.UndoReconciliation);
  });

  it('allows admins to reconcile and undo a reconciliation', () => {
    const ability = new Ability(getSuperAdminRules() as any);

    expect(ability.can(CashflowAction.Reconcile, AbilitySubject.Cashflow)).toBe(
      true,
    );
    expect(
      ability.can(CashflowAction.UndoReconciliation, AbilitySubject.Cashflow),
    ).toBe(true);
  });

  it('declares the reconciliation events', () => {
    expect(events.bankReconciliation).toEqual({
      onFinished: 'onBankReconciliationFinished',
      onUndone: 'onBankReconciliationUndone',
    });
  });
});
