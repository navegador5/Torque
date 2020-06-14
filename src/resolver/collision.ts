import { Resolver } from "./resolver";
import { Body } from "../body/body";
import { Vector, _tempVector2, _tempVector1, _tempVector3 } from "../math/vector";
import { Util } from "../common/util";
import { Manifold, Collision, Contact } from "../collision/manifold";



/**
 * 碰撞求解器
 */

export class CollisionSolver {
    private resolver: Resolver;

    constructor(resolver: Resolver) {
        this.resolver = resolver;
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
            contactNum, i, j;

        for (i = 0; i < manifolds.length; ++i) {
            manifold = manifolds[i];

            if(!manifold.isActive) continue;

            collision = manifold.collision;
            normal = collision.normal;
            tangent = collision.tangent;
            bodyA = collision.bodyA;
            bodyB = collision.bodyB;
            contactNum = manifold.contacts.length;

            for(j = 0; j < collision.contacts.length; j++) {
                contact = collision.contacts[j];

                // 接触点到刚体A质心的距离
                contact.offsetA = contact.vertex.sub(bodyA.position),
                // 接触点到刚体B质心的距离
                contact.offsetB = contact.vertex.sub(bodyB.position);
                
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
                contact.shareNormal = 1 / (invMassNormal * contactNum);
                contact.shareTangent = 1 / (invMassTangent * contactNum);

                contact.bias = this.resolver.biasFactor * 1 / dt * Math.max(0, collision.depth + this.resolver.slop);

                let normalImpulse = contact.normalImpulse,
                    tangentImpulse = contact.tangentImpulse,
                    impulse = _tempVector1;
                    
                if (normalImpulse !== 0 || tangentImpulse !== 0) {
                    impulse.x = (normal.x * normalImpulse) + (tangent.x * tangentImpulse);
                    impulse.y = (normal.y * normalImpulse) + (tangent.y * tangentImpulse);
                    
                    if(!bodyA.sleeping && !bodyA.fixed) {
                        bodyA.applyImpulse(impulse, contact.offsetA);
                    }

                    if(!bodyB.sleeping && !bodyB.fixed) {
                        bodyB.applyImpulse(impulse.inv(impulse), contact.offsetB); 
                    }
                }
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
                    bodyA.applyImpulse(impulse, contact.offsetA);
                }

                if(!bodyB.sleeping && !bodyB.fixed) {
                    bodyB.applyImpulse(impulse.inv(impulse), contact.offsetB); 
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
                !bodyA.sleeping && bodyA.applyImpulse(tangent.scl(tangentImpulse, _tempVector1), contact.offsetA);
                !bodyB.sleeping && bodyB.applyImpulse(tangent.scl(-tangentImpulse, _tempVector2), contact.offsetB); 

                impulse.x = tangent.x * tangentImpulse;
                impulse.y = tangent.y * tangentImpulse;

                if(!bodyA.sleeping && !bodyA.fixed) {
                    bodyA.applyImpulse(impulse, contact.offsetA);
                }

                if(!bodyB.sleeping && !bodyB.fixed) {
                    bodyB.applyImpulse(impulse.inv(impulse), contact.offsetB); 
                }
            }
        }
    }
    
}








