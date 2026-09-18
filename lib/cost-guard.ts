import * as budgets from 'aws-cdk-lib/aws-budgets';
import { Construct } from 'constructs';

export interface CostGuardProps {
  budgetUsd: number;
  email: string;
}

export class CostGuard extends Construct {
  constructor(scope: Construct, id: string, props: CostGuardProps) {
    super(scope, id);
    const subscribers = [{ subscriptionType: 'EMAIL', address: props.email }];

    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: 'valheim-server-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: props.budgetUsd, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        {
          notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold: 80, thresholdType: 'PERCENTAGE' },
          subscribers,
        },
        {
          notification: { notificationType: 'FORECASTED', comparisonOperator: 'GREATER_THAN', threshold: 100, thresholdType: 'PERCENTAGE' },
          subscribers,
        },
      ],
    });
  }
}
