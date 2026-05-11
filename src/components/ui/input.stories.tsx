import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Input } from "./input";
import { Label } from "./label";

const meta = {
  title: "UI/Input",
  component: Input,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  args: {
    placeholder: "Symbole (ex. AAPL)",
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = { args: { disabled: true, value: "Non éditable" } };

export const WithLabel: Story = {
  render: (args) => (
    <div className="flex w-72 flex-col gap-1.5">
      <Label htmlFor="symbol">Symbole</Label>
      <Input id="symbol" {...args} />
    </div>
  ),
};

export const Invalid: Story = {
  render: (args) => (
    <div className="flex w-72 flex-col gap-1.5">
      <Label htmlFor="amount">Montant investi</Label>
      <Input id="amount" aria-invalid {...args} placeholder="1 000 €" />
      <span className="text-danger text-xs">Le montant doit être positif.</span>
    </div>
  ),
};
