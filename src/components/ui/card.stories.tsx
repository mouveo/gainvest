import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "./button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";

const meta = {
  title: "UI/Card",
  component: Card,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const HoldingSummary: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>Apple Inc. (AAPL)</CardTitle>
        <CardDescription>PEA · 32 parts</CardDescription>
        <CardAction>
          <Button size="xs" variant="ghost">
            Détails
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground text-xs">Valeur actuelle</span>
          <span className="text-base font-medium">6 480,32 €</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground text-xs">+/- value latente</span>
          <span className="text-success text-base font-medium">+ 412,18 € (6,8 %)</span>
        </div>
      </CardContent>
      <CardFooter>
        <span className="text-muted-foreground text-xs">Dernière mise à jour il y a 12 min</span>
      </CardFooter>
    </Card>
  ),
};

export const Compact: Story = {
  render: () => (
    <Card size="sm" className="w-72">
      <CardHeader>
        <CardTitle>Coupons reçus (2026)</CardTitle>
      </CardHeader>
      <CardContent>
        <span className="text-2xl font-semibold">128,40 €</span>
      </CardContent>
    </Card>
  ),
};
