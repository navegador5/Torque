import { Body } from "../body/body";
import { Vector, _tempVector2, _tempVector1, _tempVector3 } from "../math/vector";
import { Util } from "../common/util";
import { Manifold, Collision } from "../collision/manifold";


// 接触约束
export class Contact {
    position: Vector;
    inverseMass: number;
    shareNormal: number;
    shareTangent: number;
    normalImpulse: number;
    tangentImpulse: number;
    offsetA: Vector;
    offsetB: Vector;
    depth: number;
    bias: number;

    constructor(vertex: Vector, depth: number) {
        this.position = vertex;
        this.shareNormal = 0;
        this.shareTangent = 0;
        this.inverseMass = 0;
        this.normalImpulse = 0;
        this.tangentImpulse = 0;
        this.depth = depth;
        this.bias = 0;
    }
}

/**
 * 碰撞求解器
 */

export class ContactConstraint {
    // 碰撞求解迭代次数
    private iterations: number;
    // 穿透修正误差
    private slop: number;
    // 偏移因子
    private biasFactor: number;

    constructor() {
        this.iterations = 20;
        this.slop = 0.02;
        this.biasFactor = 0.2;
    }

    /**
     * 创建一个接触约束
     * @param vertex 
     * @param depth 
     */
    create(vertex: Vector, depth: number): Contact {
        return new Contact(vertex, depth);
    }

    /**
     * 求解接触约束
     * @param manifolds 
     * @param dt 
     */
    solve(manifolds: Manifold[], dt: number) {
        this.preSolveVelocity(manifolds, dt);
        for(let i = 0; i < this.iterations; i++) {
            this.solveVelocity(manifolds, dt);
        }
    }

    /**
     * 预处理
     * @param manifolds 碰撞流形
     * @param dt 步长
     */
    preSolveVelocity(manifolds: Manifold[], dt: number) {
        let manifold: Manifold,
            collision: Collision,
            contact: Contact,
            bodyA: Body,
            bodyB: Body,
            normal: Vector,
            tangent: Vector,
            i, j;

        for (i = 0; i < manifolds.length; ++i) {
            manifold = manifolds[i];

            if(!manifold.isActive) continue;

            collision = manifold.collision;
            normal = collision.normal;
            tangent = collision.tangent;
            bodyA = collision.bodyA;
            bodyB = collision.bodyB;

            for(j = 0; j < collision.contacts.length; j++) {
                contact = collision.contacts[j];

                // 接触点到刚体A质心的距离
                contact.offsetA = contact.position.sub(bodyA.position),
                // 接触点到刚体B质心的距离
                contact.offsetB = contact.position.sub(bodyB.position);
                
                let invMassNormal = manifold.inverseMass,
                    invMassTangent = manifold.inverseMass,
                    r1 = contact.offsetA,
                    r2 = contact.offsetB,
                    rn1 = contact.offsetA.dot(normal),
                    rn2 = contact.offsetB.dot(normal),
                    rt1 = contact.offsetA.dot(tangent),
                    rt2 = contact.offsetB.dot(tangent);

                // 计算 J(M^-1)(J^T).
                invMassNormal += bodyA.invInertia * (r1.dot(r1) - rn1 * rn1);
                invMassNormal += bodyB.invInertia * (r2.dot(r2) - rn2 * rn2);
                invMassTangent += bodyA.invInertia * (r1.dot(r1) - rt1 * rt1);
                invMassTangent += bodyB.invInertia * (r2.dot(r2) - rt2 * rt2);

                // 保存 J(M^-1)(J^T)得倒数
                contact.shareNormal = 1 / invMassNormal;
                contact.shareTangent = 1 / invMassTangent;

                contact.bias = this.biasFactor * (1 / dt) * Math.max(0, contact.depth - this.slop);
            }
        }

    }
    
    /**
     * 正式处理
     * 使用sequential impulse进行快速收敛
     * 参考：https://kevinyu.net/2018/01/17/understanding-constraint-solver-in-physics-engine/
     * @param manifolds
     * @private dt
     */
    solveVelocity(manifolds: Manifold[], dt: number) {
        let manifold: Manifold,
            collision: Collision,
            contact: Contact,
            bodyA: Body,
            bodyB: Body,
            normal: Vector,
            tangent: Vector,
            normalImpulse,
            tangentImpulse,
            maxFriction,
            relativeNormal,
            relativeTangent,
            impulse = _tempVector3,
            i, j;

        for (i = 0; i < manifolds.length; i++) {
            manifold = manifolds[i];

            if(!manifold.isActive) continue;

            collision = manifold.collision;
            normal = collision.normal;
            tangent = collision.tangent;
            bodyA = collision.bodyA;
            bodyB = collision.bodyB;

            for(j = 0; j < collision.contacts.length; j++) {
                contact = collision.contacts[j];

                let velocityPointA, // 刚体A质心相对碰撞点的速度
                    velocityPointB, // 刚体B质心相对碰撞点的速度
                    relativeVelocity; // 相对速度

                _tempVector1.x = 0;
                _tempVector1.y = 0;
                _tempVector2.x = 0;
                _tempVector2.y = 0;

                contact.offsetA.croNum(bodyA.angularVelocity, _tempVector1);
                contact.offsetB.croNum(bodyB.angularVelocity, _tempVector2);
                velocityPointA = bodyA.velocity.add(_tempVector1, _tempVector1);
                velocityPointB = bodyB.velocity.add(_tempVector2, _tempVector2);
                relativeVelocity = velocityPointB.sub(velocityPointA, _tempVector1);

                // 计算法向相对速度
                relativeNormal = normal.dot(relativeVelocity);
                // 计算法向冲量
                normalImpulse = manifold.restitution * (relativeNormal + contact.bias) * contact.shareNormal;

                // sequential impulse方法，收敛法向冲量
                let oldNormalImpulse = contact.normalImpulse;
                contact.normalImpulse = Math.max(contact.normalImpulse + normalImpulse, 0);
                normalImpulse = contact.normalImpulse - oldNormalImpulse;

                // 应用冲量
                impulse.x = normal.x * normalImpulse;
                impulse.y = normal.y * normalImpulse;

                if(!bodyA.sleeping && !bodyA.fixed) {
                    bodyA.applyImpulse(impulse, contact.offsetA, dt);
                }

                if(!bodyB.sleeping && !bodyB.fixed) {
                    bodyB.applyImpulse(impulse.inv(impulse), contact.offsetB, dt); 
                }

                // --------------------------------------------------------------------------------------------

                contact.offsetA.croNum(bodyA.angularVelocity, _tempVector1);
                contact.offsetB.croNum(bodyB.angularVelocity, _tempVector2);
                velocityPointA = bodyA.velocity.add(_tempVector1, _tempVector1);
                velocityPointB = bodyB.velocity.add(_tempVector2, _tempVector2);
                relativeVelocity = velocityPointB.sub(velocityPointA, _tempVector1);

                // 计算切向相对速度
                relativeTangent = tangent.dot(relativeVelocity);
                // 计算切向冲量
                tangentImpulse = relativeTangent * contact.shareTangent;
                // 计算最大摩擦力
                maxFriction = manifold.friction * contact.normalImpulse;

                // sequential impulse方法，收敛切向冲量
                let oldTangentImpulse = contact.tangentImpulse;
                contact.tangentImpulse = Util.clamp(contact.tangentImpulse + tangentImpulse, -maxFriction, maxFriction);
                tangentImpulse = contact.tangentImpulse - oldTangentImpulse;

                // 应用冲量
                impulse.x = tangent.x * tangentImpulse;
                impulse.y = tangent.y * tangentImpulse;

                if(!bodyA.sleeping && !bodyA.fixed) {
                    bodyA.applyImpulse(impulse, contact.offsetA, dt);
                }

                if(!bodyB.sleeping && !bodyB.fixed) {
                    bodyB.applyImpulse(impulse.inv(impulse), contact.offsetB, dt); 
                }
            }
        }
    }
}







